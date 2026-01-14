export interface InitOptions {
  targetDir: string
  appName: string
  dryRun: boolean
}

export interface InitResult {
  createdFiles: string[]
  skippedFiles: string[]
  errors: string[]
}
