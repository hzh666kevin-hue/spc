/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SPC Kernel · Layer 2 — 安全引擎 (Web Crypto API)          ║
 * ║  ──────────────────────────────────────────────────────────  ║
 * ║  军工级加密: AES-256-GCM + PBKDF2 密钥派生                  ║
 * ║  零知识原则: 原始密码永远不离开内存、永不存储                 ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * 算法链路:
 *   1. 用户输入主密码 (master password)
 *   2. PBKDF2-SHA256 × 310,000 次迭代 + 随机 Salt → 派生 AES-256 密钥
 *   3. AES-256-GCM + 随机 IV (96-bit) → 加密数据
 *   4. 输出: Base64( salt[16] + iv[12] + ciphertext + tag[16] )
 *
 * 安全特性:
 *   - 每次加密使用随机 Salt + 随机 IV (无重复)
 *   - PBKDF2 迭代次数 310,000 (OWASP 2023 推荐值)
 *   - GCM 模式自带认证标签 (AEAD), 防篡改
 *   - 密码验证 hash 用于快速校验 (不泄露原始密码)
 */

const SPCCrypto = (() => {
  'use strict';

  // ─── 常量 ──────────────────────────────
  const PBKDF2_ITERATIONS = 310000;   // OWASP 2023 推荐值
  const SALT_LENGTH       = 16;       // 128-bit salt
  const IV_LENGTH         = 12;       // 96-bit IV (GCM 标准)
  const KEY_LENGTH        = 256;      // AES-256
  const HASH_ALGO         = 'SHA-256';
  const CIPHER_ALGO       = 'AES-GCM';

  /** @type {TextEncoder} 复用编码器 */
  const encoder = new TextEncoder();
  /** @type {TextDecoder} 复用解码器 */
  const decoder = new TextDecoder();


  // ═══════════════════════════════════════
  //  密钥派生
  // ═══════════════════════════════════════

  /**
   * 将用户密码导入为 PBKDF2 基础密钥
   * (这个密钥本身不能用于加密，只能用于派生)
   *
   * @param {string} password  用户主密码
   * @returns {Promise<CryptoKey>}  PBKDF2 基础密钥
   */
  async function importPasswordKey(password) {
    return crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,             // 不可导出
      ['deriveKey', 'deriveBits'],
    );
  }

  /**
   * 从密码 + salt 派生 AES-256-GCM 密钥
   *
   * @param {string} password     用户主密码
   * @param {Uint8Array} salt     16字节随机盐
   * @returns {Promise<CryptoKey>}  AES-GCM 加密密钥
   */
  async function deriveKey(password, salt) {
    const baseKey = await importPasswordKey(password);

    return crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       salt,
        iterations: PBKDF2_ITERATIONS,
        hash:       HASH_ALGO,
      },
      baseKey,
      {
        name:   CIPHER_ALGO,
        length: KEY_LENGTH,
      },
      false,          // 不可导出
      ['encrypt', 'decrypt'],
    );
  }


  // ═══════════════════════════════════════
  //  加密 / 解密
  // ═══════════════════════════════════════

  /**
   * 加密数据
   *
   * 输出格式: Base64( salt[16] || iv[12] || ciphertext || authTag[16] )
   * 每次调用都生成新的 salt 和 iv, 保证密文不重复
   *
   * @param {string} plaintext   明文 (任意字符串)
   * @param {string} password    用户主密码
   * @returns {Promise<string>}  Base64 编码的密文包
   * @throws {Error}             加密失败时抛出
   */
  async function encrypt(plaintext, password) {
    if (!plaintext && plaintext !== '') {
      throw new Error('[SPCCrypto] encrypt: 明文不能为 null/undefined');
    }
    if (!password) {
      throw new Error('[SPCCrypto] encrypt: 密码不能为空');
    }

    try {
      // 1. 生成随机 salt 和 iv
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const iv   = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

      // 2. 派生加密密钥
      const key = await deriveKey(password, salt);

      // 3. AES-256-GCM 加密
      const plaintextBytes = encoder.encode(plaintext);
      const ciphertext = await crypto.subtle.encrypt(
        { name: CIPHER_ALGO, iv: iv },
        key,
        plaintextBytes,
      );

      // 4. 组装: salt || iv || ciphertext+tag
      const ciphertextBytes = new Uint8Array(ciphertext);
      const packed = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertextBytes.length);
      packed.set(salt, 0);
      packed.set(iv, SALT_LENGTH);
      packed.set(ciphertextBytes, SALT_LENGTH + IV_LENGTH);

      // 5. Base64 编码
      return uint8ToBase64(packed);

    } catch (err) {
      throw new Error(`[SPCCrypto] 加密失败: ${err.message}`);
    }
  }

  /**
   * 解密数据
   *
   * @param {string} cipherBundle  Base64 编码的密文包 (由 encrypt 生成)
   * @param {string} password      用户主密码
   * @returns {Promise<string>}    解密后的明文
   * @throws {Error}               密码错误或数据损坏时抛出
   */
  async function decrypt(cipherBundle, password) {
    if (!cipherBundle) {
      throw new Error('[SPCCrypto] decrypt: 密文不能为空');
    }
    if (!password) {
      throw new Error('[SPCCrypto] decrypt: 密码不能为空');
    }

    try {
      // 1. Base64 解码
      const packed = base64ToUint8(cipherBundle);

      // 2. 校验最小长度: salt(16) + iv(12) + 至少1字节密文
      if (packed.length < SALT_LENGTH + IV_LENGTH + 1) {
        throw new Error('密文数据长度不足');
      }

      // 3. 拆包: salt || iv || ciphertext+tag
      const salt       = packed.slice(0, SALT_LENGTH);
      const iv         = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);

      // 4. 派生解密密钥 (使用相同的 salt)
      const key = await deriveKey(password, salt);

      // 5. AES-256-GCM 解密 (GCM 自动验证认证标签)
      const plainBytes = await crypto.subtle.decrypt(
        { name: CIPHER_ALGO, iv: iv },
        key,
        ciphertext,
      );

      return decoder.decode(plainBytes);

    } catch (err) {
      // 区分密码错误和其他错误
      if (err.name === 'OperationError') {
        throw new Error('[SPCCrypto] 解密失败: 密码错误或数据已损坏');
      }
      throw new Error(`[SPCCrypto] 解密失败: ${err.message}`);
    }
  }


  // ═══════════════════════════════════════
  //  密码验证哈希
  // ═══════════════════════════════════════

  /**
   * 生成密码验证哈希 (用于快速校验密码正确性)
   *
   * 不是存储密码! 而是:
   *   SHA-256( salt + SHA-256(password) )
   * 让我们可以在不解密全部数据的情况下验证密码
   *
   * @param {string} password
   * @returns {Promise<string>}  Base64 编码的验证哈希
   */
  async function createVerifier(password) {
    const salt = crypto.getRandomValues(new Uint8Array(32));

    // 先对密码哈希，再加盐再哈希 (双重哈希)
    const pwdHash = await crypto.subtle.digest(
      HASH_ALGO,
      encoder.encode(password),
    );

    // salt || pwdHash → 再哈希
    const combined = new Uint8Array(salt.length + pwdHash.byteLength);
    combined.set(salt, 0);
    combined.set(new Uint8Array(pwdHash), salt.length);

    const verifyHash = await crypto.subtle.digest(HASH_ALGO, combined);

    // 存储: salt + hash
    const result = new Uint8Array(salt.length + verifyHash.byteLength);
    result.set(salt, 0);
    result.set(new Uint8Array(verifyHash), salt.length);

    return uint8ToBase64(result);
  }

  /**
   * 验证密码是否与验证哈希匹配
   *
   * @param {string} password   用户输入的密码
   * @param {string} verifier   由 createVerifier 生成的验证哈希
   * @returns {Promise<boolean>}
   */
  async function checkVerifier(password, verifier) {
    try {
      const data = base64ToUint8(verifier);
      const salt = data.slice(0, 32);
      const storedHash = data.slice(32);

      const pwdHash = await crypto.subtle.digest(
        HASH_ALGO,
        encoder.encode(password),
      );

      const combined = new Uint8Array(salt.length + pwdHash.byteLength);
      combined.set(salt, 0);
      combined.set(new Uint8Array(pwdHash), salt.length);

      const computedHash = new Uint8Array(
        await crypto.subtle.digest(HASH_ALGO, combined)
      );

      // 恒定时间比较 (防时序攻击)
      return timingSafeEqual(new Uint8Array(storedHash), computedHash);

    } catch {
      return false;
    }
  }


  // ═══════════════════════════════════════
  //  密码强度分析
  // ═══════════════════════════════════════

  /**
   * 评估密码强度
   *
   * @param {string} password
   * @returns {{ score: number, level: string, label: string, percent: number, color: string }}
   *   score:   0-4 分
   *   level:   'none' | 'weak' | 'fair' | 'strong' | 'excellent'
   *   label:   中文标签
   *   percent: 百分比 (0-100)
   *   color:   Tailwind 色值类名
   */
  function evaluateStrength(password) {
    if (!password) {
      return { score: 0, level: 'none', label: '无', percent: 0, color: 'bg-gray-300' };
    }

    let score = 0;

    // 长度加分
    if (password.length >= 8)  score++;
    if (password.length >= 14) score++;
    if (password.length >= 20) score++;

    // 字符种类加分
    const hasLower   = /[a-z]/.test(password);
    const hasUpper   = /[A-Z]/.test(password);
    const hasDigit   = /\d/.test(password);
    const hasSymbol  = /[^a-zA-Z0-9]/.test(password);
    const charTypes  = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
    score += Math.max(0, charTypes - 1);

    // 惩罚: 纯数字 / 纯字母
    if (/^[0-9]+$/.test(password) || /^[a-zA-Z]+$/.test(password)) {
      score = Math.max(score - 2, 0);
    }

    // 惩罚: 连续重复字符 (aaa, 111)
    if (/(.)\1{2,}/.test(password)) {
      score = Math.max(score - 1, 0);
    }

    // 惩罚: 常见弱密码模式
    const weakPatterns = [
      /^123/, /^abc/i, /^password/i, /^qwerty/i,
      /^111/, /^000/, /^admin/i,
    ];
    if (weakPatterns.some(p => p.test(password))) {
      score = Math.max(score - 1, 0);
    }

    // 短密码封顶
    if (password.length < 6) score = Math.min(score, 1);

    const capped = Math.min(Math.max(score, 0), 4);

    const levels = [
      { level: 'weak',      label: '极弱', percent: 10,  color: 'bg-red-500'     },
      { level: 'weak',      label: '弱',   percent: 25,  color: 'bg-orange-500'  },
      { level: 'fair',      label: '一般', percent: 50,  color: 'bg-yellow-500'  },
      { level: 'strong',    label: '强',   percent: 75,  color: 'bg-emerald-500' },
      { level: 'excellent',  label: '极强', percent: 100, color: 'bg-cyan-400'    },
    ];

    return { score: capped, ...levels[capped] };
  }


  // ═══════════════════════════════════════
  //  随机密码生成器
  // ═══════════════════════════════════════

  /**
   * 生成密码学安全的随机密码
   *
   * @param {Object} options
   * @param {number}  [options.length=20]   密码长度
   * @param {boolean} [options.lowercase=true]
   * @param {boolean} [options.uppercase=true]
   * @param {boolean} [options.digits=true]
   * @param {boolean} [options.symbols=false]
   * @param {string}  [options.exclude='']  排除的字符
   * @returns {string}  生成的密码
   */
  function generatePassword(options = {}) {
    const {
      length    = 20,
      lowercase = true,
      uppercase = true,
      digits    = true,
      symbols   = false,
      exclude   = '',
    } = options;

    let charset = '';
    if (lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (digits)    charset += '0123456789';
    if (symbols)   charset += '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';

    // 排除指定字符
    if (exclude) {
      charset = charset.split('').filter(c => !exclude.includes(c)).join('');
    }

    if (!charset) throw new Error('[SPCCrypto] 密码字符集为空');

    const randomValues = crypto.getRandomValues(new Uint32Array(length));
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[randomValues[i] % charset.length];
    }
    return password;
  }


  // ═══════════════════════════════════════
  //  工具函数
  // ═══════════════════════════════════════

  /**
   * Uint8Array → Base64 (纯 JS, 无 btoa 限制)
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  function uint8ToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Base64 → Uint8Array
   * @param {string} base64
   * @returns {Uint8Array}
   */
  function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * 恒定时间比较 (防止时序攻击)
   * @param {Uint8Array} a
   * @param {Uint8Array} b
   * @returns {boolean}
   */
  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }


  // ─── 公开 API ─────────────────────────
  return {
    encrypt,
    decrypt,
    createVerifier,
    checkVerifier,
    evaluateStrength,
    generatePassword,

    // 常量 (可供调试/审计)
    PBKDF2_ITERATIONS,
    SALT_LENGTH,
    IV_LENGTH,
    KEY_LENGTH,
  };
})();
