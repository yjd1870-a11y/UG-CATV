import type { User } from '../../types';
import { request } from '../../shared/api/client';

export type ApiUser = {
  id: string;
  username: string;
  name: string;
  employeeNumber: string | null;
  department: string;
  phone: string | null;
  company: string;
  role: 'manager' | 'public_official' | 'team_leader' | 'admin';
  regionId: string | null;
  regionName: string | null;
  status: 'pending' | 'active' | 'disabled';
};

export type SignupInput = {
  username: string;
  password: string;
  name: string;
  employeeNumber?: string;
  department: string;
  phone?: string;
};

const toUiUser = (user: ApiUser): User => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  roleLabel: user.role === 'admin' ? '관리자' : user.role === 'team_leader' ? '팀장' : user.role === 'public_official' ? '공무' : '매니져',
  team: user.department,
  phone: user.phone || '',
  company: user.company,
  regionId: user.regionId || undefined,
  regionName: user.regionName || undefined,
  status: user.status,
});

export const authApi = {
  me: async () => toUiUser(await request<ApiUser>('/auth/me')),
  login: async (username: string, password: string) =>
    toUiUser(await request<ApiUser>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })),
  logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),
  signup: (input: SignupInput) => request<{ id: string; username: string; status: 'pending' }>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
};
