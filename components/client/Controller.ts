import { detect } from "detect-browser";
import { ObservableMap, makeAutoObservable } from "mobx";
import { API, Client, Nullable } from "revolt.js";

import {
  CONFIGURATION,
  getController,
  registerController,
} from "@revolt/common";
import { state } from "@revolt/state";

import Session, { SessionPrivate } from "./Session";
import { mapAnyError } from "./error";

/**
 * Controls the lifecycles of clients
 */
export default class ClientController {
  /**
   * API client
   */
  private apiClient: Client;

  /**
   * Server configuration
   */
  private configuration: API.RevoltConfig | null;

  /**
   * Map of user IDs to sessions
   */
  private sessions: ObservableMap<string, Session>;

  /**
   * User ID of active session
   */
  private current: Nullable<string>;

  constructor() {
    this.apiClient = new Client({
      apiURL: CONFIGURATION.DEFAULT_API_URL,
    });

    this.apiClient
      .fetchConfiguration()
      .then(() => (this.configuration = this.apiClient.configuration!));

    this.configuration = null;
    this.sessions = new ObservableMap();
    this.current = null;

    makeAutoObservable(this);

    this.login = this.login.bind(this);
    this.logoutCurrent = this.logoutCurrent.bind(this);

    registerController("client", this);
  }

  /**
   * Select the next available session
   */
  pickNextSession() {
    this.switchAccount(
      this.current ?? this.sessions.keys().next().value ?? null
    );
  }

  /**
   * Get the currently selected session
   * @returns Active Session
   */
  getActiveSession() {
    return this.sessions.get(this.current!);
  }

  /**
   * Get the currently ready client
   * @returns Ready Client
   */
  getReadyClient() {
    const session = this.getActiveSession();
    return session && session.ready ? session.client! : undefined;
  }

  /**
   * Get the currently ready client
   * @returns Ready Client
   */
  getReadyClients() {
    return [...this.sessions.values()]
      .filter((session) => session.ready)
      .map((session) => session.client!);
  }

  /**
   * Get an unauthenticated instance of the Revolt.js Client
   * @returns API Client
   */
  getAnonymousClient() {
    return this.apiClient;
  }

  /**
   * Get the next available client (either from session or API)
   * @returns Revolt.js Client
   */
  getAvailableClient() {
    return this.getActiveSession()?.client ?? this.apiClient;
  }

  /**
   * Fetch server configuration
   * @returns Server Configuration
   */
  getServerConfig() {
    return this.configuration;
  }

  /**
   * Check whether we are logged in right now
   * @returns Whether we are logged in
   */
  isLoggedIn() {
    return this.current !== null;
  }

  /**
   * Check whether we are currently ready
   * @returns Whether we are ready to render
   */
  isReady() {
    return this.getActiveSession()?.ready;
  }

  /**
   * Start a new client lifecycle
   * @param entry Session Information
   * @param knowledge Whether the session is new or existing
   */
  async addSession(
    entry: { session: SessionPrivate; apiUrl?: string },
    knowledge: "new" | "existing"
  ) {
    const user_id = entry.session.user_id!;

    const session = new Session();
    this.sessions.set(user_id, session);
    this.pickNextSession();

    await session
      .emit({
        action: "LOGIN",
        session: entry.session,
        apiUrl: entry.apiUrl,
        configuration: this.configuration!,
        knowledge,
      })
      .catch((err) => {
        const error = mapAnyError(err);
        if (error === "Forbidden" || error === "Unauthorized") {
          this.sessions.delete(user_id);
          this.current = null;
          this.pickNextSession();
          state.auth.removeSession(user_id);
          getController("modal").push({ type: "signed_out" });
          session.destroy();
        } else {
          getController("modal").push({
            type: "error",
            error,
          });
        }
      });
  }

  /**
   * Login given a set of credentials
   * @param credentials Credentials
   */
  async login(credentials: API.DataLogin) {
    const browser = detect();

    // Generate a friendly name for this browser
    let friendly_name;
    if (browser) {
      let { name } = browser;
      const { os } = browser;
      let isiPad;
      // TODO window.isNative
      if (false) {
        friendly_name = `Revolt Desktop on ${os}`;
      } else {
        if (name === "ios") {
          name = "safari";
        } else if (name === "fxios") {
          name = "firefox";
        } else if (name === "crios") {
          name = "chrome";
        }
        if (os === "Mac OS" && navigator.maxTouchPoints > 0) isiPad = true;
        friendly_name = `${name} on ${isiPad ? "iPadOS" : os}`;
      }
    } else {
      friendly_name = "Unknown Device";
    }

    // Try to login with given credentials
    let session = await this.apiClient.api.post("/auth/session/login", {
      ...credentials,
      friendly_name,
    });

    // Prompt for MFA verificaiton if necessary
    if (session.result === "MFA") {
      const { allowed_methods } = session;
      while (session.result === "MFA") {
        const mfa_response: API.MFAResponse | undefined = await new Promise(
          (callback) =>
            getController("modal").push({
              type: "mfa_flow",
              state: "unknown",
              available_methods: allowed_methods,
              callback,
            })
        );

        if (typeof mfa_response === "undefined") {
          break;
        }

        try {
          session = await this.apiClient.api.post("/auth/session/login", {
            mfa_response,
            mfa_ticket: session.ticket,
            friendly_name,
          });
        } catch (err) {
          console.error("Failed login:", err);
        }
      }

      if (session.result === "MFA") {
        throw "Cancelled";
      }
    }

    // Start client lifecycle
    this.addSession(
      {
        session,
      },
      "new"
    );
  }

  /**
   * Log out of a specific user session
   * @param user_id Target User ID
   */
  logout(user_id: string) {
    const session = this.sessions.get(user_id);
    if (session) {
      if (user_id === this.current) {
        this.current = null;
      }

      this.sessions.delete(user_id);
      this.pickNextSession();
      session.destroy();
    }
  }

  /**
   * Logout of the current session
   */
  logoutCurrent() {
    if (this.current) {
      this.logout(this.current);
    }
  }

  /**
   * Switch to another user session
   * @param user_id Target User ID
   */
  switchAccount(user_id: string) {
    this.current = user_id;

    // This will allow account switching to work more seamlessly,
    // maybe it'll be properly / fully implemented at some point.
    // TODO resetMemberSidebarFetched();
  }
}
