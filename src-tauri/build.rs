fn main() {
    // Read version from config file
    let version = get_version_from_config();
    println!("cargo:rustc-env=APP_VERSION={}", version);

    let mut windows = tauri_build::WindowsAttributes::new();

    // Conditional Assets Bundling for OCR
    let target_dir = std::path::Path::new("../.bundle-assets");
    let _ = std::fs::remove_dir_all(&target_dir); // clean up old
    let _ = std::fs::create_dir_all(&target_dir);
    if std::env::var("CARGO_FEATURE_OCR").is_ok() {
        let source_dir = std::path::Path::new("../assets");
        if source_dir.exists() {
            copy_dir_all(source_dir, target_dir).expect("Failed to copy assets");
        }
    }
    // create empty file to satisfy tauri bundle glob match
    let _ = std::fs::write(target_dir.join(".keep"), "");

    // Define the manifest with requireAdministrator
    let manifest = r#"
        <assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
            <dependency>
                <dependentAssembly>
                    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*" />
                </dependentAssembly>
            </dependency>
            <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
                <security>
                    <requestedPrivileges>
                        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
                    </requestedPrivileges>
                </security>
            </trustInfo>
        </assembly>
    "#;

    windows = windows.app_manifest(manifest);

    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(windows)
    ).expect("failed to run build script");
}

fn get_version_from_config() -> String {
    let content = std::fs::read_to_string("tauri.conf.json").unwrap_or_default();
    if let Some(pos) = content.find("\"version\"") {
        let after_key = &content[pos + 9..];
        if let Some(colon_pos) = after_key.find(':') {
            let after_colon = &after_key[colon_pos + 1..];
            if let Some(quote_start) = after_colon.find('"') {
                let after_quote = &after_colon[quote_start + 1..];
                if let Some(quote_end) = after_quote.find('"') {
                    return after_quote[..quote_end].trim().to_string();
                }
            }
        }
    }
    "0.1.0".to_string()
}

fn copy_dir_all(src: impl AsRef<std::path::Path>, dst: impl AsRef<std::path::Path>) -> std::io::Result<()> {
    std::fs::create_dir_all(&dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(entry.path(), dst.as_ref().join(entry.file_name()))?;
        } else {
            std::fs::copy(entry.path(), dst.as_ref().join(entry.file_name()))?;
        }
    }
    Ok(())
}
