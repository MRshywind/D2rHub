import { useGlobalConfig } from "../../store/globalConfig";
import { useTheme } from "../../store/theme";
import { surfaceOpacityVars } from "../../styles/surfaceOpacity";
import { I18nRuntime } from "../../i18n";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { config } = useGlobalConfig();
  const { theme } = useTheme();

  return (
    <div className="app-shell flex" style={surfaceOpacityVars(config?.main_opacity, theme)}>
      <I18nRuntime />
      {children}
    </div>
  );
}
