import { useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '../context/AuthContext';
import FarmerProfileForm from '../components/FarmerProfileForm';
import AuthBranding from '../components/AuthBranding';
import { t } from '../i18n/strings';

export default function FarmerRegistrationPage() {
  const { account, language, registerProfile } = useAuth();
  const { logout, loggingOut, logoutError } = useLogout();
  const navigate = useNavigate();

  const handleSubmit = async (payload) => {
    await registerProfile(payload);
    navigate('/', { replace: true });
  };

  return (
    <div className="flex flex-col w-full py-space-md gap-space-lg">
      <AuthBranding icon="agriculture" title={t(language, 'registerTitle')} subtitle={t(language, 'registerSubtitle')} />

      <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30">
        <FarmerProfileForm
          initialValues={{ preferredLanguage: language, fullName: account?.displayName || '' }}
          phoneNumber={account?.phoneNumber}
          submitLabel={t(language, 'saveProfile')}
          submittingLabel={t(language, 'saving')}
          onSubmit={handleSubmit}
        />
      </div>

      {logoutError && <p className="text-body-sm text-center text-error" role="alert">{logoutError}</p>}
      <button
        type="button"
        onClick={logout}
        disabled={loggingOut}
        className="text-on-surface-variant text-body-sm font-bold flex items-center justify-center gap-1"
      >
        <span className="material-symbols-outlined text-[16px]">logout</span>
        <span>{t(language, 'auth.useDifferentAccount')}</span>
      </button>
    </div>
  );
}
