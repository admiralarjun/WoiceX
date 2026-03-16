import React from 'react';
import { GoogleLogin } from '@react-oauth/google';
import './LandingPage.css';

export default function LandingPage({ onLoginSuccess }) {
  return (
    <div className="landing-container">
      <div className="landing-content">
        <h1 className="brand-title">Woice<span>X</span></h1>
        <p className="brand-subtitle">Your personal, voice-first intelligent agent.</p>

        <div className="login-wrapper">
          <GoogleLogin
            onSuccess={onLoginSuccess}
            onError={() => {
              console.log('Login Failed');
            }}
            theme="filled_black"
            shape="pill"
            size="large"
            text="continue_with"
          />
        </div>
      </div>

      <div className="ambient-background">
        <div className="ambient-orb orb-1"></div>
        <div className="ambient-orb orb-2"></div>
      </div>
    </div>
  );
}
