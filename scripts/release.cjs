const { Arch, Platform, build } = require("electron-builder");

build({
  targets: Platform.WINDOWS.createTarget(["nsis-web"], [Arch.x64]),
}).catch(error => {
  console.error("Aegora release build failed:", error?.message || error);
  process.exitCode = 1;
});
