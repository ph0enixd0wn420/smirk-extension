/**
 * Social Tipping Lookup Module
 *
 * User lookup and URL generation handlers.
 * NO WASM DEPENDENCIES - safe for service worker startup.
 */

import type { MessageResponse, SocialLookupResult } from '@/types';
import { api } from '@/lib/api';
import { getPendingSocialTip } from '@/lib/storage';

/**
 * Look up a social platform username to check if they're registered.
 *
 * Returns the user's public keys if registered (for encrypting tips).
 * Special case: platform "smirk" looks up by Smirk username instead of social platform.
 */
export async function handleLookupSocial(
  platform: string,
  username: string
): Promise<MessageResponse<SocialLookupResult>> {
  try {
    // Use smirk name lookup for "smirk" platform
    const result = platform === 'smirk'
      ? await api.lookupSmirkName(username)
      : await api.lookupSocial(platform, username);

    if (result.error) {
      return { success: false, error: result.error };
    }

    const data = result.data!;
    return {
      success: true,
      data: {
        registered: data.registered,
        userId: data.user_id,
        publicKeys: data.public_keys,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to lookup user',
    };
  }
}

/**
 * Get the share URL for a public tip.
 *
 * The share URL is only available after the tip has been created and stored locally.
 * This is intentionally separate from the tip creation response to prevent users
 * from sharing the URL before the tip has enough confirmations.
 *
 * @param tipId - The tip ID
 * @returns Share URL if available, null otherwise
 */
export async function handleGetPublicTipShareUrl(
  tipId: string
): Promise<MessageResponse<{ shareUrl: string | null; isPublic: boolean }>> {
  try {
    // Get the pending tip from local storage
    const pendingTip = await getPendingSocialTip(tipId);

    if (!pendingTip) {
      return {
        success: true,
        data: { shareUrl: null, isPublic: false },
      };
    }

    if (!pendingTip.isPublic || !pendingTip.publicFragmentKey) {
      return {
        success: true,
        data: { shareUrl: null, isPublic: false },
      };
    }

    // Build the share URL
    const shareUrl = `https://smirk.cash/tip/${tipId}#${pendingTip.publicFragmentKey}`;

    return {
      success: true,
      data: { shareUrl, isPublic: true },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to get share URL',
    };
  }
}
