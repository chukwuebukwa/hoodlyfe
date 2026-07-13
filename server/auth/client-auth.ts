import type {ClientAuthPayload, VerifiedAuthIdentity} from '../../shared/protocol/auth.ts';

export async function verifyClientAuth(_auth: ClientAuthPayload | undefined): Promise<VerifiedAuthIdentity> {
  return {provider: 'guest'};
}
