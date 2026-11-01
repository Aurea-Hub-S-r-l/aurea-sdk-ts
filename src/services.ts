// Written by scripts/write-services.mjs from src/generated/apis: do not edit.
import type { Configuration } from "./generated/runtime";
import { AccountsApi, AddressBookApi, AdminApi, AgentPaymentsApi, AggregatedTransactionsApi, AmlCasesApi, ApprovalsApi, AssetsApi, AuditApi, AuthApi, BankRampAddressesApi, BankRampCurrenciesApi, BankRampCustomersApi, BankRampDeskApi, BankRampLocalApi, BankRampPayinApi, BankRampPayoutApi, CardOnrampApi, CardOnrampCustomersApi, CardProgramApi, CardsApi, DappsApi, EarnApi, FeesApi, GasStationApi, GroupsApi, HealthApi, LendingApi, MpcApi, NotificationsApi, OperationsApi, PoliciesApi, PortfolioApi, QuorumApi, ReportsApi, StructuresApi, SwapApi, SwapRoutesApi, TenantsApi, TokenizedAssetsApi, TokensApi, TransactionsApi, UsersApi, WalletsApi, WebhooksApi } from "./generated/apis";

/** The generated API classes, one property each, created on first use. */
export class Services {
  #cache = new Map<unknown, unknown>();
  constructor(protected readonly configuration: Configuration) {}
  #get<T>(Ctor: new (c: Configuration) => T): T {
    let api = this.#cache.get(Ctor) as T | undefined;
    if (!api) {
      api = new Ctor(this.configuration);
      this.#cache.set(Ctor, api);
    }
    return api;
  }
  get accounts(): AccountsApi {
    return this.#get(AccountsApi);
  }
  get addressBook(): AddressBookApi {
    return this.#get(AddressBookApi);
  }
  get admin(): AdminApi {
    return this.#get(AdminApi);
  }
  get agentPayments(): AgentPaymentsApi {
    return this.#get(AgentPaymentsApi);
  }
  get aggregatedTransactions(): AggregatedTransactionsApi {
    return this.#get(AggregatedTransactionsApi);
  }
  get amlCases(): AmlCasesApi {
    return this.#get(AmlCasesApi);
  }
  get approvals(): ApprovalsApi {
    return this.#get(ApprovalsApi);
  }
  get assets(): AssetsApi {
    return this.#get(AssetsApi);
  }
  get audit(): AuditApi {
    return this.#get(AuditApi);
  }
  get auth(): AuthApi {
    return this.#get(AuthApi);
  }
  get bankRampAddresses(): BankRampAddressesApi {
    return this.#get(BankRampAddressesApi);
  }
  get bankRampCurrencies(): BankRampCurrenciesApi {
    return this.#get(BankRampCurrenciesApi);
  }
  get bankRampCustomers(): BankRampCustomersApi {
    return this.#get(BankRampCustomersApi);
  }
  get bankRampDesk(): BankRampDeskApi {
    return this.#get(BankRampDeskApi);
  }
  get bankRampLocal(): BankRampLocalApi {
    return this.#get(BankRampLocalApi);
  }
  get bankRampPayin(): BankRampPayinApi {
    return this.#get(BankRampPayinApi);
  }
  get bankRampPayout(): BankRampPayoutApi {
    return this.#get(BankRampPayoutApi);
  }
  get cardOnramp(): CardOnrampApi {
    return this.#get(CardOnrampApi);
  }
  get cardOnrampCustomers(): CardOnrampCustomersApi {
    return this.#get(CardOnrampCustomersApi);
  }
  get cardProgram(): CardProgramApi {
    return this.#get(CardProgramApi);
  }
  get cards(): CardsApi {
    return this.#get(CardsApi);
  }
  get dapps(): DappsApi {
    return this.#get(DappsApi);
  }
  get earn(): EarnApi {
    return this.#get(EarnApi);
  }
  get fees(): FeesApi {
    return this.#get(FeesApi);
  }
  get gasStation(): GasStationApi {
    return this.#get(GasStationApi);
  }
  get groups(): GroupsApi {
    return this.#get(GroupsApi);
  }
  get health(): HealthApi {
    return this.#get(HealthApi);
  }
  get lending(): LendingApi {
    return this.#get(LendingApi);
  }
  get mpc(): MpcApi {
    return this.#get(MpcApi);
  }
  get notifications(): NotificationsApi {
    return this.#get(NotificationsApi);
  }
  get operations(): OperationsApi {
    return this.#get(OperationsApi);
  }
  get policies(): PoliciesApi {
    return this.#get(PoliciesApi);
  }
  get portfolio(): PortfolioApi {
    return this.#get(PortfolioApi);
  }
  get quorum(): QuorumApi {
    return this.#get(QuorumApi);
  }
  get reports(): ReportsApi {
    return this.#get(ReportsApi);
  }
  get structures(): StructuresApi {
    return this.#get(StructuresApi);
  }
  get swap(): SwapApi {
    return this.#get(SwapApi);
  }
  get swapRoutes(): SwapRoutesApi {
    return this.#get(SwapRoutesApi);
  }
  get tenants(): TenantsApi {
    return this.#get(TenantsApi);
  }
  get tokenizedAssets(): TokenizedAssetsApi {
    return this.#get(TokenizedAssetsApi);
  }
  get tokens(): TokensApi {
    return this.#get(TokensApi);
  }
  get transactions(): TransactionsApi {
    return this.#get(TransactionsApi);
  }
  get users(): UsersApi {
    return this.#get(UsersApi);
  }
  get wallets(): WalletsApi {
    return this.#get(WalletsApi);
  }
  get webhooks(): WebhooksApi {
    return this.#get(WebhooksApi);
  }
}
