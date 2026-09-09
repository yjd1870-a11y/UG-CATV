import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ApiClientError } from '../../shared/api/client';
import loginBackground from '../../assets/images/login-network-bg.png';
import loginWorkhubLogo from '../../assets/images/login-workhub-logo.png';

export const LoginView: React.FC = () => {
  const { login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg('');

    if (!username.trim() || !password.trim()) {
      setErrorMsg('아이디와 비밀번호를 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (error) {
      setErrorMsg(
        error instanceof ApiClientError || error instanceof Error
          ? error.message
          : '로그인을 처리하지 못했습니다.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#071C2C] px-5 py-10"
      style={{
        backgroundImage: `linear-gradient(rgba(4, 20, 34, 0.48), rgba(4, 20, 34, 0.62)), url(${loginBackground})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }}
    >
      <section
        id="login-card"
        aria-label="CATV 업무관리 로그인"
        className="relative z-10 w-full max-w-[440px] rounded-3xl border border-white/60 bg-white/95 px-6 py-9 shadow-[0_24px_80px_rgba(0,12,24,0.42)] backdrop-blur-md sm:px-10 sm:py-11"
      >
        <div className="mb-8 text-center">
          <img
            src={loginWorkhubLogo}
            alt="UG WORKHUB 로고"
            className="mx-auto h-auto w-full max-w-[300px] sm:max-w-[330px]"
          />
          <p className="mx-auto mt-4 max-w-[340px] text-sm leading-6 text-slate-500">
            작업자가 필요한 현장정보를 신속히 조회 현장업무를 관리할수 있는 통합 관리시스템
          </p>
        </div>

        {errorMsg ? (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {errorMsg}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field
            id="login-username"
            label="아이디"
            value={username}
            onChange={setUsername}
            placeholder="아이디를 입력하세요"
            autoComplete="username"
          />
          <Field
            id="login-password"
            label="비밀번호"
            value={password}
            onChange={setPassword}
            placeholder="비밀번호를 입력하세요"
            type="password"
            autoComplete="current-password"
          />

          <button
            id="login-submit-btn"
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex h-12 w-full items-center justify-center rounded-xl bg-[#173B57] text-[15px] font-bold text-white shadow-sm transition hover:bg-[#102D43] focus:outline-none focus:ring-4 focus:ring-[#173B57]/20 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="mt-7 text-center text-xs text-slate-400">
          계정 관련 사항은 관리자에게 문의하세요.
        </p>
      </section>
    </main>
  );
};

const Field: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: React.HTMLInputTypeAttribute;
  autoComplete?: string;
}> = ({ id, label, value, onChange, placeholder, type = 'text', autoComplete }) => (
  <div>
    <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-700">
      {label}
    </label>
    <input
      id={id}
      name={id}
      type={type}
      autoComplete={autoComplete}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#2878B5] focus:ring-4 focus:ring-[#2878B5]/10"
    />
  </div>
);
