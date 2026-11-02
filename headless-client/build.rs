use std::process::Command;

/// Resolves the build version the same way `scripts/resolve-build-version.js`
/// does: `TALKTOME_BUILD_VERSION` wins (set by CI), otherwise the nearest
/// `v*` tag with a `-dev.N` suffix for commits after it.
fn main() {
    println!("cargo:rerun-if-env-changed=TALKTOME_BUILD_VERSION");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/tags");

    let version = std::env::var("TALKTOME_BUILD_VERSION")
        .ok()
        .map(|v| v.trim().trim_start_matches('v').to_string())
        .filter(|v| !v.is_empty())
        .or_else(git_describe_version)
        .unwrap_or_else(|| "0.0.0-dev".to_string());

    println!("cargo:rustc-env=TALKTOME_VERSION={version}");
}

fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn git_describe_version() -> Option<String> {
    let base_tag = git(&[
        "describe",
        "--tags",
        "--match",
        "v[0-9]*",
        "--abbrev=0",
        "HEAD",
    ])?;
    let base = base_tag.trim_start_matches('v').to_string();
    let distance: u64 = git(&["rev-list", "--count", &format!("{base_tag}..HEAD")])?
        .parse()
        .ok()?;
    let dirty = git(&["status", "--porcelain", "--untracked-files=no"]).is_some();
    if distance == 0 && !dirty {
        return Some(base);
    }
    let separator = if base.contains('-') { "." } else { "-" };
    Some(format!(
        "{base}{separator}dev.{distance}{}",
        if dirty { ".dirty" } else { "" }
    ))
}
