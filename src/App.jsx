import './App.css';
// import supabase from "./supabase";
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Home } from './Pages/Home/Home';
import { About } from './Pages/About/About';
import { Profile } from './Pages/Profile/Profile';
import Recommendations from './Pages/Recommendation/Recommendations';
import Notification from "./Pages/Notification/Notification";
import { Login } from './Pages/Login/Login';
import { Register } from './Pages/Register/Register';
import Navigation from './components/Navigation/Navigation';
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from './routes/ProtectedRoute';
import  Messages  from "./Pages/Message/Message";

function App() {

  return (
    <AuthProvider> 
      <Router>

        <Routes>
        <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <Navigation />
                <Home />
              </ProtectedRoute>
            } 
          />
          <Route path="/About" element={
            <ProtectedRoute>
              <Navigation />
              <About /> 
              </ProtectedRoute>
            }
            />
               <Route path="/Messages" element={
            <ProtectedRoute>
              <Navigation />
              <Messages /> 
              </ProtectedRoute>
            }
            />
              <Route path="/Notification" element={
            <ProtectedRoute>
              <Navigation />
              <Notification /> 
              </ProtectedRoute>
            }
            />
          <Route 
            path="/profile/" 
            element={
              <ProtectedRoute>
                <Navigation />
                <Profile />
              </ProtectedRoute>
            } 
          />
           <Route path="/u/:id" element={  <ProtectedRoute>
                <Navigation />
                <Profile />
              </ProtectedRoute>} />
          <Route path="/Login" element={<Login />} />
          <Route path="/Register" element={<Register />} />
          <Route path="/Recommendations" element={
            <ProtectedRoute>
              <Navigation />
               <Recommendations />
              </ProtectedRoute>
} />

        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
