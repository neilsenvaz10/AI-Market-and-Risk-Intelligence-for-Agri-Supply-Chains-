import { HttpError, mapDatabaseError } from '../utils/httpError.js';
import { validateFarmerPayload } from '../validators/farmer.validator.js';
import { createFarmer, findFarmerByUid, syncIdentity, toFarmerDto, updateFarmer } from '../services/farmer.service.js';

const validationError = (errors) =>
  new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', errors);

const identityOf = (auth) => ({
  uid: auth.uid,
  email: auth.email,
  emailVerified: auth.emailVerified,
  phoneNumber: auth.phoneNumber,
});

const queueWelcomeEmail = (req, uid) => req.app.locals.welcomeEmail?.queueWelcomeEmail(uid);

function mapUniqueViolation(err) {
  if (err.code !== '23505') return null;
  if (err.constraint === 'farmers_phone_number_key') {
    return new HttpError(409, 'PHONE_ALREADY_REGISTERED', 'This mobile number is already registered to another account.');
  }
  if (err.constraint === 'farmers_email_lower_key') {
    return new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'This email address is already registered to another account.');
  }
  return new HttpError(409, 'PROFILE_EXISTS', 'A farmer profile already exists for this account.');
}

/**
 * GET /api/auth/session
 * Confirms the token, mirrors verified identity claims onto the profile and
 * reports which registration steps remain. Only describes the caller's own account.
 */
export async function getSession(req, res, next) {
  try {
    let row = await findFarmerByUid(req.auth.uid);
    if (row) {
      row = (await syncIdentity(identityOf(req.auth))) || row;
      // Profile completed before the email was verified: send the welcome email now.
      if (row.welcome_email_status === 'pending' && row.email_verified) queueWelcomeEmail(req, req.auth.uid);
    }
    res.json({
      status: 'ok',
      authenticated: true,
      phoneNumber: req.auth.phoneNumber,
      account: {
        email: req.auth.email,
        emailVerified: req.auth.emailVerified,
        phoneNumber: req.auth.phoneNumber,
        signInProvider: req.auth.signInProvider,
      },
      profileComplete: Boolean(row),
      farmer: toFarmerDto(row),
    });
  } catch (err) {
    next(mapUniqueViolation(err) || mapDatabaseError(err));
  }
}

/** GET /api/farmers/me */
export async function getMyProfile(req, res, next) {
  try {
    const row = await findFarmerByUid(req.auth.uid);
    if (!row) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Farmer profile not found. Please complete registration.');
    res.json({ status: 'ok', farmer: toFarmerDto(row) });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}

/**
 * POST /api/farmers/me — completes registration.
 * Requires, from the verified token: a linked phone number, an email address
 * and a verified email. UID/phone/email are never read from the request body.
 */
export async function createMyProfile(req, res, next) {
  try {
    if (process.env.REQUIRE_PHONE_VERIFICATION === 'true' && !req.auth.phoneNumber) {
      throw new HttpError(400, 'PHONE_NOT_VERIFIED', 'Please verify your mobile number with OTP before completing registration.');
    }
    if (!req.auth.email) {
      throw new HttpError(400, 'EMAIL_REQUIRED', 'Please add an email address to your account before completing registration.');
    }
    if (!req.auth.emailVerified) {
      throw new HttpError(400, 'EMAIL_NOT_VERIFIED', 'Please verify your email address before completing registration.');
    }
    const { data, errors } = validateFarmerPayload(req.body, { partial: false });
    if (errors) throw validationError(errors);

    const row = await createFarmer(identityOf(req.auth), data);
    if (!row) throw new HttpError(409, 'PROFILE_EXISTS', 'A farmer profile already exists for this account.');

    // Registration is committed; email delivery is best-effort and retried on failure.
    queueWelcomeEmail(req, req.auth.uid);

    res.status(201).json({ status: 'ok', farmer: toFarmerDto(row) });
  } catch (err) {
    next(mapUniqueViolation(err) || mapDatabaseError(err));
  }
}

/** PUT /api/farmers/me — partial update of editable fields only. */
export async function updateMyProfile(req, res, next) {
  try {
    const { data, errors } = validateFarmerPayload(req.body, { partial: true });
    if (errors) throw validationError(errors);

    const row = await updateFarmer(req.auth.uid, data);
    if (!row) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Farmer profile not found. Please complete registration.');

    res.json({ status: 'ok', farmer: toFarmerDto(row) });
  } catch (err) {
    next(mapDatabaseError(err));
  }
}
