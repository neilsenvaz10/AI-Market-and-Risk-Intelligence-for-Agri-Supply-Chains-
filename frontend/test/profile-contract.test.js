import { describe, expect, it, vi } from 'vitest';
import { EMPTY_PROFILE, toPayload, validateProfile } from '../src/utils/profileValidation';
import { validateFarmerPayload } from '../../backend/src/validators/farmer.validator.js';
import { createRequireAuth } from '../../backend/src/middleware/auth.js';

// Do not initialize the Admin SDK or read backend configuration in unit tests.
vi.mock('../../backend/src/config/firebaseAdmin.js', () => ({ verifyFirebaseIdToken: vi.fn() }));

describe('frontend/backend profile contract', () => {
  it.each([
    ['en', 'Test Farmer', 'Nashik', 'Onion'],
    ['hi', 'रमेश पाटिल', 'नासिक', 'प्याज'],
    ['mr', 'रमेश पाटील', 'नाशिक', 'कांदा'],
  ])('accepts a frontend registration payload in %s', (language, name, district, crop) => {
    const values = { ...EMPTY_PROFILE, fullName: name, state: 'Maharashtra', district,
      primaryCrop: crop, cropQuantity: '25.50', preferredLanguage: language };
    expect(validateProfile(values)).toEqual({});
    const { data, errors } = validateFarmerPayload(toPayload(values), { partial: false });
    expect(errors).toBeNull();
    expect(data).toMatchObject({ fullName: name, cropQuantity: 25.5, preferredLanguage: language });
    expect(data).not.toHaveProperty('firebaseUid');
  });

  it('returns a field-error map for an empty form', () => {
    expect(validateProfile(EMPTY_PROFILE)).toMatchObject({
      fullName: 'Full name is required', state: 'Please select your state',
      district: 'District is required', primaryCrop: 'Primary crop is required',
    });
  });
});

describe('backend auth middleware (no database)', () => {
  const response = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });

  it('rejects unauthenticated requests before token verification', async () => {
    const verify = vi.fn();
    const res = response();
    const next = vi.fn();
    await createRequireAuth(verify)({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(verify).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/id-token-expired', 'TOKEN_EXPIRED'],
    ['auth/id-token-revoked', 'SESSION_REVOKED'],
    ['auth/argument-error', 'INVALID_TOKEN'],
  ])('rejects %s', async (code, expectedCode) => {
    const res = response();
    const next = vi.fn();
    await createRequireAuth(vi.fn().mockRejectedValue({ code }))(
      { headers: { authorization: 'Bearer test-only' } }, res, next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: expectedCode }));
    expect(next).not.toHaveBeenCalled();
  });

  it('derives the farmer identity only from verified claims', async () => {
    const req = { headers: { authorization: 'Bearer test-only' }, body: { uid: 'untrusted-uid' } };
    const next = vi.fn();
    const verify = vi.fn().mockResolvedValue({ uid: 'verified-uid', email: 'TEST@example.test',
      email_verified: true, phone_number: '+919000000001', firebase: { sign_in_provider: 'password' } });
    await createRequireAuth(verify)(req, response(), next);
    expect(req.auth).toMatchObject({ uid: 'verified-uid', email: 'test@example.test', emailVerified: true });
    expect(next).toHaveBeenCalledOnce();
  });
});
