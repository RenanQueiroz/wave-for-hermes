// Node-test stand-in for expo-secure-store: the constants the app reads plus
// an in-memory item store, so modules importing it load under `node --test`.
// Tests that exercise storage behavior inject their own storage instead.
const items = new Map();

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';

export async function deleteItemAsync(key) {
  items.delete(key);
}

export async function getItemAsync(key) {
  return items.get(key) ?? null;
}

export async function setItemAsync(key, value) {
  items.set(key, value);
}
