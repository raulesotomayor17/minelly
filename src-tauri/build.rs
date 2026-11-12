fn main() {
    // Rebuild the Windows resource (including the .ico) when icons change.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
