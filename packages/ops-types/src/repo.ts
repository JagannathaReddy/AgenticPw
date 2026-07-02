/**
 * Repo profile — the extracted convention doc from OnboardingWorkflow.
 * Consumed by every prompt that generates or judges test code.
 */

export type LocatorPattern =
  | 'getByRole'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByTestId'
  | 'css'
  | 'mixed';

export type PageObjectStyle =
  | 'pom_class'
  | 'plain_class'
  | 'functional_helpers'
  | 'none';

export type FilenameConvention = 'kebab-case' | 'camelCase' | 'snake_case';

export interface PlaywrightConfigFacts {
  versionDetected: string;
  testDir: string;
  projects: string[];
  baseUrlEnv: string | null;
  webServerConfigured: boolean;
}

export interface StructureFacts {
  pageObjectStyle: PageObjectStyle;
  pageObjectBaseClass: string | null;
  pageObjectDir: string | null;
  filenameConvention: FilenameConvention;
  specSuffix: string;
}

export interface LocatorFacts {
  primaryPattern: LocatorPattern;
  testIdAttribute: string | null;
  perSubdirectory: Array<{
    path: string;
    pattern: LocatorPattern;
  }>;
}

export interface AssertionFacts {
  softAssertionsUsed: boolean;
  customMatchers: string[];
  pollPatternUsed: boolean;
  visualSnapshotsUsed: boolean;
}

export interface AuthFacts {
  storageStatePath: string | null;
  globalSetupPath: string | null;
  authFixtureName: string | null;
}

export interface ImportFacts {
  testImportSource: string;
  reexportsTest: boolean;
}

export interface CustomFixture {
  name: string;
  provides: string;
}

export interface RepoProfile {
  playwright: PlaywrightConfigFacts;
  structure: StructureFacts;
  locators: LocatorFacts;
  assertions: AssertionFacts;
  auth: AuthFacts;
  imports: ImportFacts;
  fixtures: {
    customFixtures: CustomFixture[];
  };
  conventionsConfidence: number;
  notes: string;
}

/**
 * Single-file convention fingerprint. Aggregated into a RepoProfile.
 */
export interface FileConvention {
  path: string;
  locatorStyle: LocatorPattern;
  locatorExamples: string[];
  usesPageObject: boolean;
  pageObjectImport: string | null;
  importsTestFrom: string;
  usesFixtures: string[];
  hasSoftAssertions: boolean;
  hasPoll: boolean;
  hasSnapshots: boolean;
  assertionCount: number;
}

/**
 * Locators the platform has learned across runs. Persists to memory_flows.
 */
export interface LearnedLocator {
  kind: 'placeholder' | 'role' | 'label' | 'testId';
  value: string;
  name?: string;
  field?: 'username' | 'password' | 'submit' | 'other';
}

export interface NormalizedAction {
  type: string;
  summary: string;
  action?: string;
}

export interface FlowMemory {
  goalHash: string;
  goal: string;
  host: string;
  url: string;
  template: string;
  actions: NormalizedAction[];
  locators: LearnedLocator[];
  testPath?: string;
  jobId: string;
  successCount: number;
  updatedAt: string;
}
