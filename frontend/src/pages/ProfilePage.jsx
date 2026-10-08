import React from 'react';
import { Link } from 'react-router-dom';

export default function ProfilePage() {
  return (
    <div className="flex flex-col w-full pb-8">
      <div className="bg-primary text-on-primary rounded-xl p-5 shadow-md mb-6 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container">
          <span className="material-symbols-outlined text-[36px]">person</span>
        </div>
        <div>
          <h2 className="font-headline-md text-headline-md text-on-primary">Ramesh Patil</h2>
          <p className="text-body-sm text-primary-fixed-dim">Nashik District, Maharashtra</p>
          <span className="inline-block mt-1 text-xs bg-secondary px-2 py-0.5 rounded-full font-bold">Verified Farmer</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30">
          <h3 className="font-headline-md text-headline-md text-on-surface mb-2">Registered Produce</h3>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-secondary-container text-on-secondary-container rounded-lg text-body-sm font-bold">
              Tomato (1,000 kg)
            </span>
            <span className="px-3 py-1 bg-surface-container rounded-lg text-body-sm text-on-surface">
              Onion (2,500 kg)
            </span>
          </div>
        </div>

        <div className="bg-surface-container-lowest p-4 rounded-xl shadow-sm border border-outline-variant/30 flex flex-col gap-3">
          <h3 className="font-headline-md text-headline-md text-on-surface">Settings & Preferences</h3>
          <div className="flex items-center justify-between py-2 border-b border-surface-container">
            <span className="text-body-md text-on-surface">SMS / WhatsApp Alerts</span>
            <span className="text-secondary font-bold text-body-sm">Active</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-surface-container">
            <span className="text-body-md text-on-surface">App Language</span>
            <span className="text-on-surface-variant text-body-sm font-medium">मराठी (Marathi)</span>
          </div>
          <Link
            to="/onboarding"
            className="text-secondary text-body-sm font-bold flex items-center gap-1 pt-1"
          >
            <span>Re-open Language Selection</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
