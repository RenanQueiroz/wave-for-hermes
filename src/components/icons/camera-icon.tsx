import { useIconColor, type IconProps } from 'panelui-native';
import Svg, { Path } from 'react-native-svg';

/**
 * A camera body with a lens — capturing a new photo. PanelUI ships no camera
 * glyph, so this follows its icon contract: same props, same stroke style,
 * and the same inherited-surface colour with the same muted fallback.
 */
export function CameraIcon({ size = 16, color, ...props }: IconProps) {
  const inherited = useIconColor();
  const resolved = color ?? inherited ?? '#737373';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <Path
        d="M4 7h3.5L9 4.5h6L16.5 7H20v13H4zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"
        stroke={resolved}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
