import { GoogleLogin } from '@react-oauth/google'
import axios from "axios"

function App() {

  const handleSuccess = async (credentialResponse) => {

    const res = await axios.post(
      "http://localhost:8000/auth/google",
      {
        token: credentialResponse.credential
      }
    )

    localStorage.setItem("jwt", res.data.access_token)
  }

  return (
    <div>
      <h1>Login</h1>

      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => console.log("Login Failed")}
      />

    </div>
  )
}

export default App