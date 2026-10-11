/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApiMessage,
  ConfirmEmailDto,
  ForgetPasswordDto,
  LoginDto,
  LoginResponseDto,
  RegisterDto,
  ResendConfirmationDto,
  ResetPasswordDto,
  UserProfileDto,
} from '../types/api';
import { apiService, getAccessToken, setAccessToken } from './api';

export class AuthService {
  public getToken(): string | null {
    return getAccessToken();
  }

  public setToken(token: string | null): void {
    setAccessToken(token);
  }

  public clearToken(): void {
    setAccessToken(null);
  }

  public isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) {
      return false;
    }

    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(payloadBase64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join(''),
        );
        const payload = JSON.parse(jsonPayload) as { exp?: number };
        if (typeof payload.exp === 'number') {
          const nowInSeconds = Math.floor(Date.now() / 1000);
          return payload.exp > nowInSeconds;
        }
      }
    } catch {
      return true;
    }

    return true;
  }

  public async register(dto: RegisterDto): Promise<void> {
    return apiService.register(dto);
  }

  public async login(dto: LoginDto): Promise<LoginResponseDto> {
    return apiService.login(dto);
  }

  public async logout(): Promise<void> {
    return apiService.logout();
  }

  public async refresh(refreshToken?: string): Promise<LoginResponseDto> {
    return apiService.refresh(refreshToken);
  }

  /** Try to refresh the access token using the HttpOnly refresh cookie.
   *  Returns true if a new token was issued and stored, false otherwise. */
  public async tryRefresh(): Promise<boolean> {
    try {
      const res = await apiService.refresh();
      return Boolean(res?.token);
    } catch {
      return false;
    }
  }

  public async confirmEmail(dto: ConfirmEmailDto): Promise<ApiMessage> {
    return apiService.confirmEmail(dto);
  }

  public async resendConfirmation(dto: ResendConfirmationDto): Promise<ApiMessage> {
    return apiService.resendConfirmation(dto);
  }

  public async forgetPassword(dto: ForgetPasswordDto): Promise<ApiMessage> {
    return apiService.forgetPassword(dto);
  }

  public async resetPassword(dto: ResetPasswordDto): Promise<ApiMessage> {
    return apiService.resetPassword(dto);
  }

  public async getMyProfile(): Promise<UserProfileDto> {
    return apiService.getMyProfile();
  }
}

const authService = new AuthService();

export default authService;
export { authService };