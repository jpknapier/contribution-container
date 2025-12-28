import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../App';
import { Button } from '../components/Button';
import { calculatePayrollForMonth } from '../src/lib/payroll/engine';
import { getTaxTableSet, listTaxTableYears } from '../src/lib/payroll/taxTables';
import { BonusEvent, BonusWithholdingMethod, PayrollSettings } from '../src/lib/payroll/types';
import { formatMonthLabel } from '../lib/format';

const PayrollSettingsPage: React.FC = () => {
  const { settings, updateSettings, currentSnapshot } = useApp();
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedTaxTableYear, setSelectedTaxTableYear] = useState<number | null>(null);
  const [previewMonthId, setPreviewMonthId] = useState<string>(currentSnapshot?.id || settings.last_opened_month);

  const incomeCategories = [...settings.categories]
    .filter(category => category.type === 'income')
    .sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => {
    listTaxTableYears().then(setAvailableYears);
  }, []);

  useEffect(() => {
    getTaxTableSet(settings.payroll_settings.tax_year).then(table => {
      setSelectedTaxTableYear(table ? settings.payroll_settings.tax_year : null);
    });
  }, [settings.payroll_settings.tax_year]);

  const updatePayrollSettings = (patch: Partial<PayrollSettings>) => {
    updateSettings({ payroll_settings: { ...settings.payroll_settings, ...patch } });
  };

  const update401k = (patch: Partial<PayrollSettings['401k']>) => {
    updatePayrollSettings({ '401k': { ...settings.payroll_settings['401k'], ...patch } });
  };

  const updateBenefits = (patch: Partial<PayrollSettings['benefits']>) => {
    updatePayrollSettings({ benefits: { ...settings.payroll_settings.benefits, ...patch } });
  };

  const updateFica = (patch: Partial<PayrollSettings['fica']>) => {
    updatePayrollSettings({ fica: { ...settings.payroll_settings.fica, ...patch } });
  };

  const updateBonus = (id: string, patch: Partial<BonusEvent>) => {
    const next = settings.payroll_settings.bonus_events.map(event =>
      event.id === id ? { ...event, ...patch } : event
    );
    updatePayrollSettings({ bonus_events: next });
  };

  const addBonus = () => {
    const base: BonusEvent = {
      id: crypto.randomUUID(),
      date: `${previewMonthId}-01`,
      gross_amount: 0,
      method: 'supplemental_flat',
      description: ''
    };
    updatePayrollSettings({ bonus_events: [...settings.payroll_settings.bonus_events, base] });
  };

  const removeBonus = (id: string) => {
    updatePayrollSettings({
      bonus_events: settings.payroll_settings.bonus_events.filter(event => event.id !== id)
    });
  };

  const [previewResult, setPreviewResult] = useState<Awaited<ReturnType<typeof calculatePayrollForMonth>> | null>(null);

  useEffect(() => {
    let isActive = true;
    const loadPreview = async () => {
      if (!selectedTaxTableYear || !previewMonthId) {
        if (isActive) setPreviewResult(null);
        return;
      }
      const table = await getTaxTableSet(selectedTaxTableYear);
      if (!isActive) return;
      if (!table) {
        setPreviewResult(null);
        return;
      }
      const anchorDate = currentSnapshot?.month_setup?.paycheck_anchor_date || `${previewMonthId}-01`;
      const result = calculatePayrollForMonth({
        monthId: previewMonthId,
        schedule: settings.payroll_settings.pay_cycle,
        anchorDate,
        payrollSettings: settings.payroll_settings,
        taxTables: table
      });
      setPreviewResult(result);
    };
    loadPreview();
    return () => { isActive = false; };
  }, [selectedTaxTableYear, previewMonthId, currentSnapshot?.month_setup?.paycheck_anchor_date, settings.payroll_settings]);

  const formatCurrency = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: settings.preferred_currency,
  }).format(value);

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h2 className="text-3xl font-extrabold text-slate-900">Payroll Settings</h2>
        <p className="text-slate-500">Configure payroll assumptions and preview paycheck estimates.</p>
        <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
          Estimates only; verify with your paystub or tax professional. No legal or tax advice.
        </p>
      </div>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Paycheck Defaults</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Pay Schedule</label>
            <select
              value={settings.payroll_settings.pay_cycle}
              onChange={(e) => updatePayrollSettings({ pay_cycle: e.target.value as PayrollSettings['pay_cycle'] })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="semimonthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Paycheck Anchor Date</label>
            <input
              type="date"
              value={settings.payroll_settings.paycheck_anchor_date || ''}
              onChange={(e) => updatePayrollSettings({ paycheck_anchor_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Paycheck Category</label>
            <select
              value={settings.payroll_settings.paycheck_category_id || ''}
              onChange={(e) => updatePayrollSettings({ paycheck_category_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Select category</option>
              {incomeCategories.map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Tax Year & Filing</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Tax Year</label>
            <input
              type="number"
              value={settings.payroll_settings.tax_year}
              onChange={(e) => updatePayrollSettings({ tax_year: Number(e.target.value) || settings.payroll_settings.tax_year })}
              className="w-full px-3 py-2 border rounded-lg"
            />
            {availableYears.length > 0 && (
              <div className="text-xs text-slate-400">Available: {availableYears.join(', ')}</div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Filing Status</label>
            <select
              value={settings.payroll_settings.filing_status}
              onChange={(e) => updatePayrollSettings({ filing_status: e.target.value as PayrollSettings['filing_status'] })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="single">Single</option>
              <option value="married_joint">Married Filing Jointly</option>
              <option value="head_of_household">Head of Household</option>
            </select>
          </div>
        </div>
      </section>
      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Income & Withholding</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Annual Salary</label>
            <input
              type="number"
              value={settings.payroll_settings.salary_annual}
              onChange={(e) => updatePayrollSettings({ salary_annual: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Dependents</label>
            <input
              type="number"
              value={settings.payroll_settings.dependents_count}
              onChange={(e) => updatePayrollSettings({ dependents_count: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Dependent Credit Override</label>
            <input
              type="number"
              value={settings.payroll_settings.dependent_credit_override ?? ''}
              onChange={(e) => updatePayrollSettings({ dependent_credit_override: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Other Income (Annual)</label>
            <input
              type="number"
              value={settings.payroll_settings.other_income_annual ?? 0}
              onChange={(e) => updatePayrollSettings({ other_income_annual: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Deductions (Annual)</label>
            <input
              type="number"
              value={settings.payroll_settings.deductions_annual ?? 0}
              onChange={(e) => updatePayrollSettings({ deductions_annual: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Extra Withholding / Paycheck</label>
            <input
              type="number"
              value={settings.payroll_settings.extra_withholding_per_paycheck ?? 0}
              onChange={(e) => updatePayrollSettings({ extra_withholding_per_paycheck: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">State Withholding Flat Rate (%)</label>
            <input
              type="number"
              value={settings.payroll_settings.state_withholding_flat_rate ?? 0}
              onChange={(e) => updatePayrollSettings({ state_withholding_flat_rate: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">401(k)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={settings.payroll_settings['401k'].enabled}
              onChange={(e) => update401k({ enabled: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label className="text-sm font-medium text-slate-700">Enable 401(k)</label>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Contribution Mode</label>
            <select
              value={settings.payroll_settings['401k'].contribution_mode}
              onChange={(e) => update401k({ contribution_mode: e.target.value as PayrollSettings['401k']['contribution_mode'] })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="percent">Percent</option>
              <option value="fixed_per_paycheck">Fixed / Paycheck</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Contribution Value</label>
            <input
              type="number"
              value={settings.payroll_settings['401k'].contribution_value}
              onChange={(e) => update401k({ contribution_value: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={settings.payroll_settings['401k'].enforce_annual_max}
              onChange={(e) => update401k({ enforce_annual_max: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label className="text-sm font-medium text-slate-700">Enforce Annual Max</label>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={settings.payroll_settings['401k'].catch_up_enabled}
              onChange={(e) => update401k({ catch_up_enabled: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label className="text-sm font-medium text-slate-700">Catch-up Enabled</label>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Catch-up Override</label>
            <input
              type="number"
              value={settings.payroll_settings['401k'].catch_up_amount_override ?? ''}
              onChange={(e) => update401k({ catch_up_amount_override: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Benefits & FICA</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Pre-tax Benefits / Paycheck</label>
            <input
              type="number"
              value={settings.payroll_settings.benefits.pre_tax_benefits_per_paycheck}
              onChange={(e) => updateBenefits({ pre_tax_benefits_per_paycheck: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Post-tax Deductions / Paycheck</label>
            <input
              type="number"
              value={settings.payroll_settings.benefits.post_tax_deductions_per_paycheck}
              onChange={(e) => updateBenefits({ post_tax_deductions_per_paycheck: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              checked={settings.payroll_settings.fica.include_fica}
              onChange={(e) => updateFica({ include_fica: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label className="text-sm font-medium text-slate-700">Include FICA</label>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">SS Wage Base Override</label>
            <input
              type="number"
              value={settings.payroll_settings.fica.ss_wage_base_override ?? ''}
              onChange={(e) => updateFica({ ss_wage_base_override: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Additional Medicare Threshold Override</label>
            <input
              type="number"
              value={settings.payroll_settings.fica.additional_medicare_threshold_override ?? ''}
              onChange={(e) => updateFica({ additional_medicare_threshold_override: e.target.value === '' ? undefined : Number(e.target.value) })}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Bonus Events</h3>
          <Button onClick={addBonus} variant="secondary" type="button">
            Add Bonus
          </Button>
        </div>
        <div className="space-y-3">
          {settings.payroll_settings.bonus_events.map(event => (
            <div key={event.id} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center">
              <input
                type="date"
                value={event.date}
                onChange={(e) => updateBonus(event.id, { date: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              />
              <input
                type="number"
                value={event.gross_amount}
                onChange={(e) => updateBonus(event.id, { gross_amount: Number(e.target.value) || 0 })}
                className="px-3 py-2 border rounded-lg"
              />
              <select
                value={event.method}
                onChange={(e) => updateBonus(event.id, { method: e.target.value as BonusWithholdingMethod })}
                className="px-3 py-2 border rounded-lg"
              >
                <option value="supplemental_flat">Supplemental Flat</option>
                <option value="regular_annualized">Regular Annualized</option>
              </select>
              <input
                type="text"
                value={event.description || ''}
                onChange={(e) => updateBonus(event.id, { description: e.target.value })}
                placeholder="Description"
                className="px-3 py-2 border rounded-lg md:col-span-2"
              />
              <Button onClick={() => removeBonus(event.id)} variant="danger" size="sm" type="button">
                Remove
              </Button>
            </div>
          ))}
          {settings.payroll_settings.bonus_events.length === 0 && (
            <p className="text-sm text-slate-400 italic">No bonus events configured.</p>
          )}
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-800">Preview</h3>
          <input
            type="month"
            value={previewMonthId}
            onChange={(e) => setPreviewMonthId(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
        {!selectedTaxTableYear && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Import tax tables for {settings.payroll_settings.tax_year} to enable payroll estimates.{' '}
            <Link to="/tax-tables" className="underline">Manage tax tables</Link>.
          </div>
        )}
        {previewResult && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2 font-bold">Date</th>
                  <th className="px-4 py-2 font-bold text-right">Gross</th>
                  <th className="px-4 py-2 font-bold text-right">401(k)</th>
                  <th className="px-4 py-2 font-bold text-right">Pre-tax</th>
                  <th className="px-4 py-2 font-bold text-right">Federal</th>
                  <th className="px-4 py-2 font-bold text-right">State</th>
                  <th className="px-4 py-2 font-bold text-right">FICA</th>
                  <th className="px-4 py-2 font-bold text-right">Post-tax</th>
                  <th className="px-4 py-2 font-bold text-right">Net</th>
                  <th className="px-4 py-2 font-bold text-right">YTD Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewResult.paychecks.map(entry => (
                  <tr key={entry.id}>
                    <td className="px-4 py-2 text-slate-600">
                      {formatMonthLabel(entry.date.slice(0, 7))} {entry.date.slice(8)}
                    </td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.gross)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.k401_contribution)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.pre_tax_benefits)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.federal_withholding)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.state_withholding)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.fica_withholding)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(entry.post_tax_deductions)}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatCurrency(entry.net)}</td>
                    <td className="px-4 py-2 text-right text-slate-500">{formatCurrency(entry.ytd.net)}</td>
                  </tr>
                ))}
                {previewResult.paychecks.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-slate-400 italic">
                      No paychecks for this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default PayrollSettingsPage;
