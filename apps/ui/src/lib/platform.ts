// What this system is, as far as the copy is concerned. Every screen that names where something is kept asks here,
// so no screen can say "macOS" to a Windows user.

/** Where keys are kept on this system: the macOS Keychain, or an encrypted file in the data folder elsewhere (Windows). */
export function secureStore(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'the macOS Keychain' : 'an encrypted file in the data folder';
}