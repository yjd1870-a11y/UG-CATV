export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_POLICY_MESSAGE = '비밀번호는 8자 이상이며 영문, 숫자, 특수문자를 각각 1자 이상 포함해야 합니다.';

const specialCharacters = new Set(`!@#$%^&*()_+-=[]{};:'"\\|,.<>/?\`~`);

export const isValidPassword = (password: string) => (
  password.length >= PASSWORD_MIN_LENGTH
  && password.length <= PASSWORD_MAX_LENGTH
  && /[A-Za-z]/.test(password)
  && /\d/.test(password)
  && [...password].some((character) => specialCharacters.has(character))
);
