const requiredMajor = 24;
const actualVersion = process.versions.node;
const actualMajor = Number.parseInt(actualVersion.split(".")[0], 10);

if (actualMajor !== requiredMajor) {
  throw new Error(
    `Talktome standalone builds require Node ${requiredMajor}.x; current runtime is ${actualVersion}`
  );
}
