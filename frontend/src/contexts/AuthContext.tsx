import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthSessionResponse } from '@feecore/shared-types';
import { apiClient, ApiError, authStorage, setUnauthorizedHandler } from '../lib/apiClient.js';

export interface LoginCredentials {
  tenantId: string;
  email: string;
  password: string;
}

export { ApiError };

interface AuthContextValue {
  session: AuthSessionResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  userRole: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restored = authStorage.load();
    if (restored?.accessToken) {
      setSession(restored);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null);
      authStorage.clear();
    });
  }, []);

  const login = async (credentials: LoginCredentials) => {
    const response = await apiClient.post<AuthSessionResponse>(
      `/tenants/${credentials.tenantId}/auth/login`,
      { email: credentials.email, password: credentials.password },
    );

    authStorage.save(response);
    setSession(response);
  };

  const logout = () => {
    authStorage.clear();
    setSession(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        isAuthenticated: !!session,
        isLoading,
        userRole: session?.user.role || null,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
