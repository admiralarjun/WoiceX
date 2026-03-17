import { useState } from 'react';
import LandingPage from './components/LandingPage';
import VoiceInterface from './components/VoiceInterface';
import axios from "axios";

function App() {
  const [token, setToken] = useState(localStorage.getItem('jwt'));

  const handleSuccess = async (credentialResponse) => {

    const res = await axios.post(
      "http://localhost:8000/auth/google",
      {
        token: credentialResponse.credential
      }
    )
    console.log(res.data)
    localStorage.setItem("jwt", res.data.access_token)
    setToken(res.data.access_token)
  }

  const handleLogout = () => {
    localStorage.removeItem("jwt");
    setToken(null);
  }

  if (token) {
    return <VoiceInterface token={token} onLogout={handleLogout} />;
  }

  return <LandingPage onLoginSuccess={handleSuccess} />;
}

export default App