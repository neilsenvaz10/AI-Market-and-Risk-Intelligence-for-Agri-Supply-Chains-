import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import FarmerProfileForm from '../components/FarmerProfileForm';
import { formatPhone, formatQuantity } from '../constants/profile';
import { languageLabel } from '../i18n/languages';
import { getAuthErrorMessage } from '../services/authService';

/** Sign-in methods linked to this Firebase account; Google can be linked while signed in. */
function SignInMethodsCard() {
  const { account, linkGoogle } = useAuth();
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState(null);
  const providers = account?.providers || [];
  const hasGoogle = providers.includes('google.com');

  const handleLinkGoogle = async () => {
    setLinking(true);
    setMessage(null);
    try {
      await linkGoogle();
      setMessage({ tone: 'ok', text: 'Google Sign-In is now linked to your account.' });
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
        setMessage({ tone: 'error', text: getAuthErrorMessage(err) });
      }
    } finally {
      setLinking(false);
    }
  };

  const row = (label, status, ok) => (
    <div className="flex items-center justify-between py-2 border-b border-surface-container gap-3">
      <span className="text-body-md text-on-surface">{label}</span>
      <span className={`text-body-sm font-bold ${ok ? 'text-secondary' : 'text-on-surface-variant'}`}>{status}</span>
    </div>
  );

  return (
    <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-3">
      <h3 className="font-headline-md text-headline-md text-on-surface">Sign-in Methods</h3>
      {row('Email & Password', providers.includes('password') ? 'Active' : 'Not set', providers.includes('password'))}
      {row('Google', hasGoogle ? 'Linked' : 'Not linked', hasGoogle)}
      {row('Mobile (OTP verified)', account?.phoneNumber ? 'Verified' : 'Not verified', Boolean(account?.phoneNumber))}
      {!hasGoogle && (
        <button type="button" onClick={handleLinkGoogle} disabled={linking}
          className="text-secondary text-body-sm font-bold flex items-center gap-1 pt-1 disabled:opacity-60">
          <span>{linking ? 'Linking Google...' : 'Link Google Account'}</span>
          <span className={`material-symbols-outlined text-[16px] ${linking ? 'animate-spin' : ''}`}>{linking ? 'progress_activity' : 'link'}</span>
        </button>
      )}
      {message && (
        <p className={`text-body-sm ${message.tone === 'ok' ? 'text-secondary font-bold' : 'text-error'}`} role={message.tone === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { farmer, saveProfile } = useAuth();
  const { logout, loggingOut, logoutError } = useLogout();
  const [editing, setEditing] = useState(false);
  const [success, setSuccess] = useState(null);

  if (!farmer) return null; // ProtectedRoute guarantees a profile

  const location = [farmer.village, `${farmer.district} District`, farmer.state].filter(Boolean).join(', ');

  const handleSave = async (payload) => {
    await saveProfile(payload);
    setEditing(false);
    setSuccess('Profile updated successfully.');
  };

  return (
    <div className="flex flex-col w-full pb-8">
      <div className="bg-primary text-on-primary rounded-xl p-5 shadow-md mb-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0">
          <span className="material-symbols-outlined text-[36px]">person</span>
        </div>
        <div className="min-w-0">
          <h2 className="font-headline-md text-headline-md text-on-primary break-words">{farmer.fullName}</h2>
          <p className="text-body-sm text-primary-fixed-dim">{location}</p>
          <span className="inline-block mt-1 text-xs bg-secondary px-2 py-0.5 rounded-full font-bold">Verified Farmer</span>
        </div>
      </div>

      {success && !editing && (
        <div className="bg-secondary-container text-on-secondary-container p-3 rounded-xl mb-3 flex items-center gap-3 shadow-sm" role="status">
          <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          <p className="font-body-sm text-xs font-bold flex-1">{success}</p>
          <button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {editing ? (
        <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-3">
          <h3 className="font-headline-md text-headline-md text-on-surface">Edit Profile</h3>
          <FarmerProfileForm
            initialValues={farmer}
            phoneNumber={farmer.phoneNumber}
            submitLabel="Save Changes"
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30">
            <h3 className="font-headline-md text-headline-md text-on-surface mb-2">Registered Produce</h3>
            <div className="flex gap-2 flex-wrap">
              <span className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-lg text-body-sm font-bold">
                {farmer.primaryCrop} ({formatQuantity(farmer.cropQuantity, farmer.quantityUnit)})
              </span>
            </div>
          </div>

          <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-3">
            <h3 className="font-headline-md text-headline-md text-on-surface">Farmer Details</h3>
            <div className="flex items-center justify-between py-2 border-b border-surface-container gap-3">
              <span className="text-body-md text-on-surface">Email</span>
              <span className="text-on-surface-variant text-body-sm font-medium flex items-center gap-1 min-w-0 break-all text-right">
                {farmer.email || '—'}
                {farmer.emailVerified && (
                  <span className="material-symbols-outlined text-secondary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    verified
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-surface-container gap-3">
              <span className="text-body-md text-on-surface">Mobile Number</span>
              <span className="text-on-surface-variant text-body-sm font-medium flex items-center gap-1">
                {formatPhone(farmer.phoneNumber)}
                <span className="material-symbols-outlined text-secondary text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  verified
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-surface-container gap-3">
              <span className="text-body-md text-on-surface">State</span>
              <span className="text-on-surface-variant text-body-sm font-medium text-right">{farmer.state}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-surface-container gap-3">
              <span className="text-body-md text-on-surface">District</span>
              <span className="text-on-surface-variant text-body-sm font-medium text-right">{farmer.district}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-surface-container gap-3">
              <span className="text-body-md text-on-surface">Village / Town</span>
              <span className="text-on-surface-variant text-body-sm font-medium text-right">{farmer.village || '—'}</span>
            </div>
            <button
              type="button"
              onClick={() => { setSuccess(null); setEditing(true); }}
              className="text-secondary text-body-sm font-bold flex items-center gap-1 pt-1"
            >
              <span>Edit Profile</span>
              <span className="material-symbols-outlined text-[16px]">edit</span>
            </button>
          </div>

          <SignInMethodsCard />

          <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-3">
            <h3 className="font-headline-md text-headline-md text-on-surface">Settings & Preferences</h3>
            <div className="flex items-center justify-between py-2 border-b border-surface-container">
              <span className="text-body-md text-on-surface">SMS / WhatsApp Alerts</span>
              <span className="text-secondary font-bold text-body-sm">Active</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-surface-container">
              <span className="text-body-md text-on-surface">App Language</span>
              <span className="text-on-surface-variant text-body-sm font-medium">{languageLabel(farmer.preferredLanguage)}</span>
            </div>
            <Link
              to="/onboarding"
              className="text-secondary text-body-sm font-bold flex items-center gap-1 pt-1"
            >
              <span>Re-open Language Selection</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </Link>
          </div>

          {logoutError && (
            <div className="bg-error-container text-on-error-container p-3 rounded-xl flex items-center gap-3 shadow-sm" role="alert">
              <span className="material-symbols-outlined text-error text-[22px]">warning</span>
              <p className="font-body-sm text-xs flex-1">{logoutError}</p>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="w-full py-3 rounded-xl bg-surface-container-lowest text-error border border-error/40 font-label-lg text-label-lg shadow-sm flex items-center justify-center gap-space-sm active:scale-95 transition-transform disabled:opacity-60"
          >
            <span className={`material-symbols-outlined ${loggingOut ? 'animate-spin' : ''}`}>
              {loggingOut ? 'progress_activity' : 'logout'}
            </span>
            <span>{loggingOut ? 'Logging out...' : 'Log Out'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
