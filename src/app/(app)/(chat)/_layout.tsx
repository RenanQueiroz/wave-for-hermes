import { usePathname } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { Platform } from 'react-native';

import { isChatDrawerRoute } from '@/features/navigation/chat-drawer-route';
import { WaveDrawerContent } from '@/features/navigation/wave-drawer-content';
import { useTheme } from '@/hooks/use-theme';

export default function ChatDrawerLayout() {
  const pathname = usePathname();
  const theme = useTheme();
  const chatRoute = isChatDrawerRoute(pathname);

  return (
    <Drawer
      drawerContent={(props) => <WaveDrawerContent {...props} />}
      screenOptions={{
        drawerStyle: {
          backgroundColor: theme.background,
          borderRightColor: theme.backgroundElement,
          width: '88%',
        },
        headerShadowVisible: false,
        headerShown: Platform.OS === 'android' && chatRoute,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerTitleAlign: 'left',
        overlayColor: 'rgba(0, 0, 0, 0.36)',
        swipeEdgeWidth: 36,
        swipeEnabled: chatRoute,
      }}>
      {/* The drawer contains only conversation routes. Utility screens are
          siblings in the parent native stack, so this chrome cannot leak into
          Settings, Search, or Development. */}
      <Drawer.Screen
        name="(stack)"
        options={{ title: pathname === '/new' ? 'New chat' : '' }}
      />
    </Drawer>
  );
}
