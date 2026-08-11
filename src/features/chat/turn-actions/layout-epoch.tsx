import { createContext, useContext } from 'react';

/**
 * Legend List repositions native-backed message cells without necessarily
 * committing a new React tree. iOS action rows use this settled-layout epoch
 * to refresh only their SwiftUI subtree after that move.
 */
const TurnActionLayoutEpochContext = createContext('0:0');

export const TurnActionLayoutEpochProvider =
  TurnActionLayoutEpochContext.Provider;

export function useTurnActionLayoutEpoch(): string {
  return useContext(TurnActionLayoutEpochContext);
}
