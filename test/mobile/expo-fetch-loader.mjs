const shimUrl = new URL('./expo-fetch-test-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'expo/fetch') {
    return {
      shortCircuit: true,
      url: shimUrl,
    };
  }
  return nextResolve(specifier, context);
}
