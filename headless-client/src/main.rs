mod audio;
mod config;
mod devtools;
mod health;
mod rtc;
mod run;
mod signalling;
mod state;
mod surfaces;
mod talk;
mod tls;
mod web;

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};

use config::{Config, LoadedConfig};

pub const VERSION: &str = env!("TALKTOME_VERSION");

#[derive(Parser, Debug)]
#[command(name = "talktome-headless", version = VERSION, about = "Talktome headless intercom client")]
struct Cli {
    /// Instance name; loads /etc/talktome-headless/<instance>.json or .toml
    #[arg(long, global = true, env = "TALKTOME_INSTANCE_NAME")]
    instance: Option<String>,

    /// Explicit configuration file (.json or .toml)
    #[arg(long, short = 'c', global = true, env = "TALKTOME_CONFIG")]
    config: Option<PathBuf>,

    /// Configuration directory used with --instance
    #[arg(long, global = true, default_value = config::DEFAULT_CONFIG_DIR)]
    config_dir: PathBuf,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Run the client (default)
    Run,
    /// Validate the configuration and print the effective values
    CheckConfig,
    /// List ALSA audio devices as seen by this client
    ListAudioDevices,
    /// List attached Stream Decks
    ListStreamdecks,
    /// List GPIO chips and line names
    ListGpio,
    /// Diagnostics that use the configured account
    #[command(subcommand)]
    Dev(DevCommand),
}

#[derive(Subcommand, Debug)]
enum DevCommand {
    /// Log in, register and send a test tone to a target
    SendTone {
        /// Target such as user:4 or conference:1
        #[arg(long)]
        target: String,
        #[arg(long, default_value_t = 10)]
        seconds: u64,
        #[arg(long, default_value_t = 440.0)]
        frequency: f32,
    },
    /// Log in, register and record everything addressed to this user
    Record {
        #[arg(long, short = 'o')]
        out: PathBuf,
        #[arg(long, default_value_t = 15)]
        seconds: u64,
    },
}

fn load_config(cli: &Cli) -> Result<LoadedConfig> {
    if let Some(path) = &cli.config {
        return config::load_from_path(path);
    }
    if let Some(instance) = &cli.instance {
        let path = config::locate_instance_config(&cli.config_dir, instance)?;
        return config::load_from_path(&path);
    }
    config::load_from_env().context(
        "no configuration given: use --config <file>, --instance <name> or TALKTOME_* variables",
    )
}

/// Restarts after a web-UI request: under systemd a clean exit lets
/// `Restart=always` start us again; otherwise the binary re-executes itself
/// with the same arguments.
fn restart_process() -> Result<()> {
    if web::running_under_systemd() {
        tracing::info!(
            event = "restart-exit",
            "exiting for systemd to restart the service"
        );
        std::process::exit(0);
    }
    use std::os::unix::process::CommandExt;
    let exe = std::env::current_exe().context("locating own executable")?;
    let args: Vec<std::ffi::OsString> = std::env::args_os().skip(1).collect();
    tracing::info!(event = "restart-exec", exe = %exe.display());
    let error = std::process::Command::new(exe).args(args).exec();
    Err(anyhow::anyhow!("re-executing failed: {error}"))
}

fn init_logging(config: Option<&Config>) {
    use std::io::IsTerminal;
    use tracing_subscriber::EnvFilter;

    let level = config
        .map(|c| c.log.level.clone())
        .unwrap_or_else(|| "info".into());
    let filter = EnvFilter::try_from_env("TALKTOME_LOG")
        .or_else(|_| EnvFilter::try_new(format!("{level},webrtc=warn,webrtc_ice=warn,webrtc_dtls=warn,webrtc_srtp=warn,webrtc_sctp=warn,webrtc_mdns=warn,hyper=warn,reqwest=warn,tungstenite=warn,rustls=warn")))
        .unwrap_or_else(|_| EnvFilter::new("info"));
    let format = config.map(|c| c.log.format.as_str()).unwrap_or("auto");
    let json = match format {
        "json" => true,
        "text" => false,
        _ => !std::io::stderr().is_terminal(),
    };
    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_writer(std::io::stderr);
    if json {
        builder
            .json()
            .flatten_event(true)
            .with_current_span(false)
            .init();
    } else {
        builder.init();
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let command = cli.command.as_ref().unwrap_or(&Command::Run);

    match command {
        Command::ListAudioDevices => {
            init_logging(None);
            return audio::list_devices();
        }
        Command::ListStreamdecks => {
            init_logging(None);
            return surfaces::streamdeck::list();
        }
        Command::ListGpio => {
            init_logging(None);
            return surfaces::gpio::list();
        }
        _ => {}
    }

    let loaded = match load_config(&cli) {
        Ok(loaded) => loaded,
        Err(error) => {
            init_logging(None);
            return Err(error);
        }
    };
    init_logging(Some(&loaded.config));

    match command {
        Command::CheckConfig => {
            let redacted = loaded.config.redacted();
            println!(
                "{}",
                serde_json::to_string_pretty(&redacted).context("serializing configuration")?
            );
            if let Some(path) = &loaded.path {
                tracing::info!(event = "config-ok", path = %path.display(), instance = %loaded.config.instance);
            }
            Ok(())
        }
        Command::Run => {
            let runtime = tokio::runtime::Runtime::new()?;
            let outcome = runtime.block_on(run::run(loaded))?;
            drop(runtime);
            if outcome == run::RunOutcome::Restart {
                restart_process()?;
            }
            Ok(())
        }
        Command::Dev(dev) => {
            let runtime = tokio::runtime::Runtime::new()?;
            runtime.block_on(async move {
                match dev {
                    DevCommand::SendTone {
                        target,
                        seconds,
                        frequency,
                    } => {
                        let target = devtools::parse_target(target)?;
                        devtools::send_tone(&loaded.config, target, *seconds, *frequency).await
                    }
                    DevCommand::Record { out, seconds } => {
                        devtools::record(&loaded.config, out, *seconds).await
                    }
                }
            })
        }
        Command::ListAudioDevices | Command::ListStreamdecks | Command::ListGpio => unreachable!(),
    }
}

#[cfg(test)]
mod packaging_tests {
    #[test]
    fn systemd_unit_does_not_require_optional_groups() {
        let unit = include_str!("../deploy/systemd/talktome-headless@.service");
        for line in unit.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                continue;
            }
            assert!(
                !trimmed.starts_with("SupplementaryGroups="),
                "hardcoded SupplementaryGroups= fails with 216/GROUP when gpio/plugdev is missing: {trimmed}"
            );
        }
        assert!(
            unit.contains("User=talktome-headless"),
            "User= still loads audio/plugdev/gpio from the user database"
        );
    }

    #[test]
    fn postinst_joins_device_groups_only_when_they_exist() {
        let postinst = include_str!("../debian/postinst");
        assert!(
            postinst.contains("getent group \"$grp\""),
            "postinst must skip missing audio/plugdev/gpio"
        );
        assert!(
            postinst.contains("for grp in audio plugdev gpio"),
            "postinst should still join device groups that exist"
        );
    }
}
