import getConfig from '../config/near';
import * as nearAPI from 'near-api-js';
import { Base64 } from 'js-base64';
import { sentryCaptureException } from './sentry';
import queryString from 'query-string';

class Near {
  constructor() {
    this.currentUser = null;
    this.config = {};
    this.wallet = {};
    this.signer = {};
  }

  async authToken() {
    if (!this.currentUser) {
      return null;
    }

    try {
      const accountId = this.currentUser.accountId;
      const arr = new Array(accountId);
      for (var i = 0; i < accountId.length; i++) {
        arr[i] = accountId.charCodeAt(i);
      }
      const msgBuf = new Uint8Array(arr);
      const signedMsg = await this.signer.signMessage(msgBuf, this.wallet._authData.accountId, this.wallet._networkId);
      const pubKey = Buffer.from(signedMsg.publicKey.data).toString('hex');
      const signature = Buffer.from(signedMsg.signature).toString('hex');
      const payload = [accountId, pubKey, signature];
      return Base64.encode(payload.join('&'));
    } catch (err) {
      sentryCaptureException(err);
      return null;
    }
  }

  async init() {
    const nearConfig = getConfig(process.env.APP_ENV || 'development');

    try {
      const urlSearchParams = queryString.parse(window.location.search);
      const { successLogin, account_id } = urlSearchParams;

      const near = await nearAPI.connect({
        deps: {
          keyStore: new nearAPI.keyStores.BrowserLocalStorageKeyStore(),
        },
        ...nearConfig,
      });

      let idLogin;
      const connectedAcc = this.getAccountAndKey();
      const haveNotLogin = connectedAcc.every((acc) => acc.accountId !== account_id);

      if (successLogin && haveNotLogin) {
        localStorage.setItem('ACTIVE_ACCOUNT', successLogin);
        idLogin = successLogin;
      } else if (!haveNotLogin && account_id) {
        const { key } = connectedAcc.filter((acc) => acc.accountId === account_id)[0];
        localStorage.setItem('ACTIVE_ACCOUNT', key);
        idLogin = key;
      }

      // Needed to access wallet
      const appKeyPrefix = `paras-v2-${idLogin || localStorage.getItem('ACTIVE_ACCOUNT') || 0}`;
      const wallet = new nearAPI.WalletConnection(near, appKeyPrefix);
      this.wallet = wallet;

      // Load in account data
      let currentUser;
      if (wallet.getAccountId()) {
        currentUser = {
          accountId: wallet.getAccountId(),
          balance: await wallet.account().getAccountBalance(),
        };
      }

      this.currentUser = currentUser;
      this.config = nearConfig;
      this.signer = new nearAPI.InMemorySigner(wallet._keyStore);
    } catch (err) {
      sentryCaptureException(err);
      throw err;
    }
  }

  async login() {
    if (this.getAccountAndKey().length === 3) {
      return;
    }

    if (!this.wallet.requestSignIn) {
      await this.init();
    }

    const appTitle = 'Paras — Digital Art Cards Market';
    this.wallet.requestSignIn(
      process.env.MARKETPLACE_CONTRACT_ID,
      appTitle,
      `${window.location.href}?successLogin=${new Date().getTime()}`
    );
  }

  logout() {
    this.wallet.signOut();
    const authAccId = this.getAccountAndKey();
    localStorage.setItem('ACTIVE_ACCOUNT', authAccId[0]?.key);

    window.location.replace(window.location.origin + window.location.pathname);
  }

  getAccountAndKey = () => {
    const accountAndKey = Object.entries({ ...localStorage })
      .filter((authkey) => authkey[0].includes('wallet_auth_key') && authkey[0].includes('paras-v2'))
      .map((authkey) => ({
        key: authkey[0].replace('_wallet_auth_key', '').replace('paras-v2-', ''),
        accountId: JSON.parse(authkey[1]).accountId,
      }));
    return accountAndKey;
  };

  switchAccount = (key) => {
    localStorage.setItem('ACTIVE_ACCOUNT', key);
    window.location.replace(window.location.origin + window.location.pathname);
  };
}

const near = new Near();

export default near;
