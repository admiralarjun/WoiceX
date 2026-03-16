import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { GoogleOAuthProvider } from '@react-oauth/google'

ReactDOM.createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId="7977328900-tm466e45f1lh3k1rmti75ko739u3smi2.apps.googleusercontent.com">
    <App />
  </GoogleOAuthProvider>
)