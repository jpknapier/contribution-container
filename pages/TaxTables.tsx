import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { getTaxTableSet, listTaxTableYears, saveTaxTableSet, validateTaxTableSet } from '../src/lib/payroll/taxTables';
import { TaxTableSet } from '../src/lib/payroll/types';
import exampleTaxTable from '../src/assets/taxTables/example_tax_table.json';

const TaxTablesPage: React.FC = () => {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [table, setTable] = useState<TaxTableSet | null>(null);
  const [importText, setImportText] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    listTaxTableYears().then((years) => {
      setAvailableYears(years);
      if (years.length > 0) {
        setSelectedYear(years[0]);
      }
    });
  }, []);

  useEffect(() => {
    if (selectedYear === null) {
      setTable(null);
      return;
    }
    getTaxTableSet(selectedYear).then(setTable);
  }, [selectedYear]);

  const handleImport = async (raw: string) => {
    setStatus('');
    setErrors([]);
    try {
      const parsed = JSON.parse(raw);
      const validation = validateTaxTableSet(parsed);
      if (!validation.valid) {
        setErrors(validation.errors);
        return;
      }
      await saveTaxTableSet(parsed as TaxTableSet);
      setStatus(`Saved tax table for ${parsed.tax_year}.`);
      const years = await listTaxTableYears();
      setAvailableYears(years);
      setSelectedYear(parsed.tax_year);
      setTable(parsed as TaxTableSet);
    } catch (error) {
      setErrors([`Import failed: ${(error as Error).message}`]);
    }
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = String(ev.target?.result || '');
      setImportText(text);
      await handleImport(text);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleExport = () => {
    if (!table) return;
    const blob = new Blob([JSON.stringify(table, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax_table_${table.tax_year}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    if (!table) return null;
    const bracketCounts = Object.entries(table.federal_income_tax_brackets).map(([status, brackets]) => ({
      status,
      count: brackets.length
    }));
    return { bracketCounts };
  }, [table]);

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h2 className="text-3xl font-extrabold text-slate-900">Tax Tables Manager</h2>
        <p className="text-slate-500">Import and manage year-based tax tables (estimate only).</p>
        <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
          Estimates only; verify with your paystub or tax professional. No legal or tax advice.
        </p>
      </div>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Current Tables</h3>
        <div className="flex flex-wrap gap-3 items-center">
          <select
            value={selectedYear ?? ''}
            onChange={(e) => setSelectedYear(e.target.value ? Number(e.target.value) : null)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">Select Year</option>
            {availableYears.map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          <Button onClick={handleExport} variant="secondary" type="button" disabled={!table}>
            Export Selected
          </Button>
        </div>
        {table && summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <div className="font-semibold text-slate-700">Standard Deduction</div>
              <div className="text-slate-500">Single: {table.standard_deduction.single}</div>
              <div className="text-slate-500">Married Joint: {table.standard_deduction.married_joint}</div>
              <div className="text-slate-500">Head of Household: {table.standard_deduction.head_of_household}</div>
            </div>
            <div className="space-y-1">
              <div className="font-semibold text-slate-700">Federal Brackets</div>
              {summary.bracketCounts.map(item => (
                <div key={item.status} className="text-slate-500">
                  {item.status.replace('_', ' ')}: {item.count} brackets
                </div>
              ))}
            </div>
          </div>
        )}
        {!table && (
          <div className="text-sm text-slate-400 italic">No tax table selected.</div>
        )}
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Import / Update</h3>
        <p className="text-xs text-slate-500">
          Use JSON formatted tax tables. Do not rely on the example data for real tax decisions.
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          <label className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg font-semibold hover:bg-slate-200 transition cursor-pointer">
            Upload JSON
            <input type="file" className="hidden" accept=".json,application/json" onChange={handleImportFile} />
          </label>
          <Button
            onClick={() => {
              const text = JSON.stringify(exampleTaxTable, null, 2);
              setImportText(text);
            }}
            variant="secondary"
            type="button"
          >
            Load Example Template
          </Button>
          <Button onClick={() => handleImport(importText)} variant="primary" type="button">
            Save Imported Table
          </Button>
        </div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={10}
          className="w-full px-3 py-2 border rounded-lg font-mono text-xs"
          placeholder="Paste tax table JSON here"
        />
        {status && <div className="text-sm text-green-600">{status}</div>}
        {errors.length > 0 && (
          <div className="text-sm text-red-600 space-y-1">
            {errors.map((err) => (
              <div key={err}>{err}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default TaxTablesPage;
