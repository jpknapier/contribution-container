export type StateWithholdingResult = {
  withholding: number;
};

export type StateTaxPluginInput = {
  gross: number;
  taxableWages: number;
  filingStatus: string;
  date: string;
};

export type StateTaxPlugin = (input: StateTaxPluginInput) => StateWithholdingResult;
