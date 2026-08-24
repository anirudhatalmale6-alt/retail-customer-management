import { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, clearToken, getToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on reload: the token is in localStorage, but only the
  // server can say whether it is still valid and what role it now carries.
  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api.me()
      .then(({ user }) => setUser(user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { token, user } = await api.login(email, password);
    setToken(token);
    setUser(user);
    return user;
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  /** Mirrors the server's capability check so the UI hides what it cannot do. */
  const can = (capability) => !!user?.capabilities?.includes(capability);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

export const ROLE_LABELS = {
  admin: 'Administrator',
  back_office: 'Back office',
  front_of_house: 'Shop floor',
};
