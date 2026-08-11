import { usePathname } from 'expo-router';
import { Drawer } from 'expo-router/drawer';

import { isChatDrawerRoute } from '@/features/navigation/chat-drawer-route';
import { WaveDrawerContent } from '@/features/navigation/wave-drawer-content';
import { useTheme } from '@/hooks/use-theme';

export default function ChatDrawerLayout() {
  const pathname = usePathname();
  const theme = useTheme();

  return (
    <Drawer
      drawerContent={(props) => <WaveDrawerContent {...props} />}
      screenOptions={{
        drawerStyle: {
          backgroundColor: theme.background,
          borderRightColor: theme.backgroundElement,
          width: '88%',
        },
        headerShown: false,
        overlayColor: 'rgba(0, 0, 0, 0.36)',
        swipeEdgeWidth: 36,
        swipeEnabled: isChatDrawerRoute(pathname),
      }}>
      {/* The drawer contains only conversation routes. Utility screens are
          siblings in the parent native stack, so this chrome cannot leak into
          Settings, Search, or Development. */}
      <Drawer.Screen name="(stack)" />
    </Drawer>
  );
}
