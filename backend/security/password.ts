import bcrypt from 'bcryptjs';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const bcryptRounds = 12;
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

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, bcryptRounds);
};

export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    return bcrypt.compare(password, storedHash);
  }

  // Existing installations used scrypt. Keep verification compatibility and
  // transparently replace the hash with bcrypt after the next successful login.
  const [algorithm, salt, hashHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !hashHex) return false;

  const storedKey = Buffer.from(hashHex, 'hex');
  const derivedKey = (await scryptAsync(password, salt, storedKey.length)) as Buffer;
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey);
};

export const passwordNeedsRehash = (storedHash: string) => !storedHash.startsWith('$2');
