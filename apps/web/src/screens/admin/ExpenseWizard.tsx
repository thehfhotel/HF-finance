import { useMemo, useRef, useState } from 'react';
import type { Expense, PaymentMethod, PlLineDef } from '@reimbursement/shared';
import { PL_LINES, PL_LINE_BY_CODE } from '@reimbursement/shared';
import type { Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { fmt } from '../../lib/format';
import {
  api,
  expenseFormFromFields,
  staffReceiptFormFromFields,
  type EmployeeOption,
} from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import { IconBtn, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { FormRow } from '../../components/FormRow';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { addMonths, currentMonth, thaiMonthLabel, todayIso } from './_shared';

type Step = 'photo' | 'amount' | 'line' | 'variant' | 'payment' | 'employee' | 'confirm';

/** 'staff' = an employee paid out of pocket → becomes a reimbursement Receipt. */
type PayChoice = PaymentMethod | 'staff';

interface ExpenseWizardProps {
  theme: Theme;
  nav: Nav;
  /** Present = edit an existing ledger entry (starts at the summary step). */
  edit?: Expense;
}

const ACTIVE_LINES = PL_LINES.filter((line) => line.active);
const GROUPS: string[] = [...new Set(ACTIVE_LINES.map((line) => line.group))];

function linesInGroup(group: string): PlLineDef[] {
  return ACTIVE_LINES.filter((line) => line.group === group);
}

/**
 * บันทึกบิล — one-question-per-screen flow for the office admin:
 * photo → amount → category → (building/variant) → how it was paid →
 * confirm. Designed for a low-tech user: big targets, no jargon, every
 * step skippable-back via the header arrow.
 */
export function ExpenseWizard({ theme, nav, edit }: ExpenseWizardProps) {
  const editLine = edit ? PL_LINE_BY_CODE[edit.plLine] : undefined;

  const [step, setStep] = useState<Step>(edit ? 'confirm' : 'photo');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(edit?.photoPath ?? null);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : '');
  const [group, setGroup] = useState<string | null>(editLine?.group ?? null);
  const [plLine, setPlLine] = useState<string | null>(edit?.plLine ?? null);
  const [payChoice, setPayChoice] = useState<PayChoice>(edit?.paymentMethod ?? 'transfer');
  const [employees, setEmployees] = useState<EmployeeOption[] | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [month, setMonth] = useState(edit?.expenseMonth ?? currentMonth());
  const [vendor, setVendor] = useState(edit?.vendor ?? '');
  const [invoiceDate, setInvoiceDate] = useState(edit?.invoiceDate ?? '');
  const [billingPeriod, setBillingPeriod] = useState(edit?.billingPeriod ?? '');
  const [paid, setPaid] = useState(edit?.paid ?? true);
  const [dueDate, setDueDate] = useState(edit?.dueDate ?? '');
  const [note, setNote] = useState(edit?.note ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const lineDef = plLine ? PL_LINE_BY_CODE[plLine] : null;
  const amountNumber = parseFloat(amount) || 0;

  const stepOrder: Step[] = useMemo(() => {
    const steps: Step[] = ['photo', 'amount', 'line'];
    if (group && linesInGroup(group).length > 1) steps.push('variant');
    steps.push('payment');
    if (payChoice === 'staff') steps.push('employee');
    steps.push('confirm');
    return steps;
  }, [group, payChoice]);

  const stepIndex = stepOrder.indexOf(step);

  const goBack = () => {
    if (edit && step === 'confirm') {
      nav({ name: 'ledger' });
      return;
    }
    if (stepIndex <= 0) {
      nav({ name: 'ledger' });
      return;
    }
    setStep(stepOrder[stepIndex - 1]);
  };

  const onFile = (file: File) => {
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
    setStep('amount');
  };

  const pickGroup = (g: string) => {
    setGroup(g);
    const lines = linesInGroup(g);
    if (lines.length === 1) {
      setPlLine(lines[0].code);
      setStep('payment');
    } else {
      setPlLine(null);
      setStep('variant');
    }
  };

  const pickPayment = (choice: PayChoice) => {
    setPayChoice(choice);
    if (choice === 'staff') {
      if (employees === null) {
        api.expenses.employees().then(setEmployees).catch(() => setEmployees([]));
      }
      setStep('employee');
    } else {
      setStep('confirm');
    }
  };

  const canSave =
    amountNumber > 0 &&
    plLine !== null &&
    !submitting &&
    (payChoice !== 'staff' || employeeId !== null);

  const handleSave = async () => {
    if (!canSave || plLine === null) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      if (payChoice === 'staff') {
        // Staff paid out of pocket → a Receipt in the reimbursement flow.
        const form = staffReceiptFormFromFields(
          {
            employeeId: employeeId as string,
            plLine,
            amount: amountNumber,
            date: invoiceDate || todayIso(),
            vendor,
            note,
          },
          photoFile ?? undefined,
        );
        await api.expenses.staffReceipt(form);
      } else if (edit) {
        const form = expenseFormFromFields(
          {
            plLine,
            expenseMonth: month,
            amount: amountNumber,
            vendor,
            invoiceDate,
            billingPeriod,
            paymentMethod: payChoice,
            paid,
            dueDate: paid ? '' : dueDate,
            note,
          },
          photoFile ?? undefined,
        );
        await api.expenses.update(edit.id, form);
      } else {
        const form = expenseFormFromFields(
          {
            plLine,
            expenseMonth: month,
            amount: amountNumber,
            vendor,
            invoiceDate,
            billingPeriod,
            paymentMethod: payChoice,
            paid,
            dueDate: paid ? '' : dueDate,
            note,
          },
          photoFile ?? undefined,
        );
        await api.expenses.create(form);
      }
      nav({ name: 'ledger', month: payChoice === 'staff' ? undefined : month });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!edit) return;
    setSubmitting(true);
    try {
      await api.expenses.delete(edit.id);
      nav({ name: 'ledger', month: edit.expenseMonth });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setSubmitting(false);
    }
  };

  const bigChoice = (label: string, sub: string | null, onClick: () => void, selected = false) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        width: '100%',
        padding: '18px 20px',
        borderRadius: 16,
        background: selected ? theme.ink : theme.surface,
        color: selected ? theme.paper : theme.ink,
        border: `0.5px solid ${selected ? theme.ink : theme.hairlineStrong}`,
        fontFamily: FONT_UI,
        fontSize: 17,
        fontWeight: 600,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      {label}
      {sub && (
        <div style={{ fontSize: 12, fontWeight: 400, marginTop: 3, color: selected ? theme.paper : theme.inkSoft }}>
          {sub}
        </div>
      )}
    </button>
  );

  const question = (text: string) => (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: 26,
        color: theme.ink,
        margin: '4px 20px 18px',
        lineHeight: 1.25,
      }}
    >
      {text}
    </div>
  );

  return (
    <div style={{ paddingBottom: 24 }}>
      <AppBar
        theme={theme}
        leading={<IconBtn theme={theme} onClick={goBack}>{Icon.back(theme.ink)}</IconBtn>}
        title={edit ? 'แก้ไขบิล' : 'บันทึกบิล'}
        trailing={
          !edit ? (
            <span style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>
              {stepIndex + 1}/{stepOrder.length}
            </span>
          ) : undefined
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />

      {step === 'photo' && (
        <>
          {question('ถ่ายรูปบิล / ใบแจ้งหนี้')}
          <div style={{ padding: '0 20px' }}>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                height: 300,
                background: theme.surface2,
                borderRadius: 18,
                border: `1.5px dashed ${theme.hairlineStrong}`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                gap: 12,
                color: theme.inkSoft,
              }}
            >
              {Icon.camera(theme.inkSoft)}
              <div style={{ fontFamily: FONT_UI, fontSize: 15, fontWeight: 500, color: theme.ink }}>
                แตะเพื่อถ่ายหรือเลือกรูป
              </div>
            </div>
            <button
              onClick={() => setStep('amount')}
              style={{
                width: '100%',
                marginTop: 14,
                padding: '14px 0',
                background: 'transparent',
                border: 'none',
                fontFamily: FONT_UI,
                fontSize: 14,
                color: theme.inkSoft,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              ไม่มีรูป — ข้ามขั้นตอนนี้
            </button>
          </div>
        </>
      )}

      {step === 'amount' && (
        <>
          {question('ยอดเงินตามบิล เท่าไหร่?')}
          <div style={{ padding: '0 20px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                borderBottom: `1px solid ${theme.hairlineStrong}`,
                paddingBottom: 12,
              }}
            >
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 40, color: theme.inkSoft }}>฿</span>
              <input
                type="text"
                autoFocus
                value={amount}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, '');
                  const parts = raw.split('.');
                  const cleaned =
                    parts.length <= 1 ? raw : parts[0] + '.' + parts.slice(1).join('').slice(0, 2);
                  setAmount(cleaned);
                }}
                placeholder="0.00"
                inputMode="decimal"
                style={{
                  flex: 1,
                  width: '100%',
                  minWidth: 0,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: FONT_DISPLAY,
                  fontSize: 56,
                  color: theme.ink,
                  padding: 0,
                  lineHeight: 1,
                }}
              />
            </div>
            <div style={{ marginTop: 20 }}>
              <PrimaryButton theme={theme} disabled={amountNumber <= 0} onClick={() => setStep('line')}>
                ถัดไป
              </PrimaryButton>
            </div>
          </div>
        </>
      )}

      {step === 'line' && (
        <>
          {question('เป็นค่าใช้จ่ายหมวดไหน?')}
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {GROUPS.map((g) =>
              bigChoice(
                g,
                linesInGroup(g).length > 1
                  ? linesInGroup(g).map((l) => l.variant).join(' · ')
                  : null,
                () => pickGroup(g),
                group === g,
              ),
            )}
          </div>
        </>
      )}

      {step === 'variant' && group && (
        <>
          {question(`${group} — ของที่ไหน?`)}
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {linesInGroup(group).map((line) =>
              bigChoice(
                line.variant ?? line.label,
                null,
                () => {
                  setPlLine(line.code);
                  setStep('payment');
                },
                plLine === line.code,
              ),
            )}
          </div>
        </>
      )}

      {step === 'payment' && (
        <>
          {question('บริษัทจ่ายยังไง?')}
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bigChoice('โอนจ่าย', 'โอนจากบัญชีบริษัท', () => pickPayment('transfer'), payChoice === 'transfer')}
            {bigChoice('เงินสด', 'จ่ายสดจากลิ้นชัก/เงินสดย่อย', () => pickPayment('cash'), payChoice === 'cash')}
            {bigChoice(
              'พนักงานจ่ายไปก่อน',
              'สร้างใบเสร็จเบิกคืนให้พนักงาน',
              () => pickPayment('staff'),
              payChoice === 'staff',
            )}
          </div>
        </>
      )}

      {step === 'employee' && (
        <>
          {question('พนักงานคนไหนจ่ายไปก่อน?')}
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {employees === null ? (
              <div style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.inkSoft }}>กำลังโหลดรายชื่อ...</div>
            ) : employees.length === 0 ? (
              <div style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.inkSoft }}>ไม่พบรายชื่อพนักงาน</div>
            ) : (
              employees.map((employee) =>
                bigChoice(
                  employee.name,
                  null,
                  () => {
                    setEmployeeId(employee.id);
                    setStep('confirm');
                  },
                  employeeId === employee.id,
                ),
              )
            )}
          </div>
        </>
      )}

      {step === 'confirm' && (
        <>
          {question(edit ? 'ตรวจและแก้ไขรายละเอียด' : 'ตรวจอีกครั้ง แล้วบันทึก')}
          <div style={{ padding: '0 20px' }}>
            {/* Photo thumb + retake */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                height: photoPreview ? 160 : 64,
                background: theme.surface2,
                borderRadius: 14,
                border: photoPreview ? 'none' : `1.5px dashed ${theme.hairlineStrong}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                overflow: 'hidden',
                marginBottom: 16,
              }}
            >
              {photoPreview ? (
                <img src={photoPreview} alt="บิล" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
                  + เพิ่มรูปบิล (ถ้ามี)
                </span>
              )}
            </div>

            {/* Amount + line, tappable to revisit */}
            <div
              onClick={() => setStep('amount')}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                paddingBottom: 12,
                borderBottom: `0.5px solid ${theme.hairline}`,
                marginBottom: 14,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink }}>
                {lineDef?.label ?? '— เลือกหมวด —'}
              </span>
              <span style={{ fontFamily: FONT_DISPLAY, fontSize: 28, color: theme.ink }}>{fmt(amountNumber)}</span>
            </div>

            <FormRow
              theme={theme}
              label="วิธีจ่าย"
              value={payChoice}
              onChange={(v) => pickPayment(v as PayChoice)}
              select
              options={['transfer', 'cash', 'staff']}
              optionLabels={{ transfer: 'โอนจ่าย', cash: 'เงินสด', staff: 'พนักงานจ่ายไปก่อน' }}
            />

            {payChoice === 'staff' ? (
              <FormRow
                theme={theme}
                label="พนักงาน"
                value={employees?.find((e) => e.id === employeeId)?.name ?? '— เลือกพนักงาน —'}
                onChange={() => setStep('employee')}
                readOnly
              />
            ) : (
              <FormRow
                theme={theme}
                label="เดือนของงบ"
                value={month}
                onChange={setMonth}
                select
                options={[addMonths(currentMonth(), -1), currentMonth()]}
                optionLabels={{
                  [addMonths(currentMonth(), -1)]: thaiMonthLabel(addMonths(currentMonth(), -1)),
                  [currentMonth()]: thaiMonthLabel(currentMonth()),
                }}
              />
            )}

            <FormRow theme={theme} label="ร้าน / ผู้ออกบิล" value={vendor} onChange={setVendor} placeholder="เช่น การไฟฟ้า, โฮมโปร" />

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
                วันที่ในบิล (ถ้ามี)
              </div>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: theme.surface,
                  border: `0.5px solid ${theme.hairlineStrong}`,
                  fontFamily: FONT_UI,
                  fontSize: 15,
                  color: theme.ink,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {payChoice !== 'staff' && (lineDef?.group === 'ค่าไฟฟ้า' || lineDef?.group === 'ค่าน้ำประปา') && (
              <FormRow
                theme={theme}
                label="งวดบิล (ถ้ามี)"
                value={billingPeriod}
                onChange={setBillingPeriod}
                placeholder="เช่น มิ.ย. 69"
              />
            )}

            {payChoice !== 'staff' && (
              <>
                <FormRow
                  theme={theme}
                  label="สถานะจ่าย"
                  value={paid ? 'paid' : 'unpaid'}
                  onChange={(v) => setPaid(v === 'paid')}
                  select
                  options={['paid', 'unpaid']}
                  optionLabels={{ paid: 'จ่ายแล้ว', unpaid: 'ยังไม่จ่าย (ค้างจ่าย)' }}
                />
                {!paid && (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8 }}>
                      ครบกำหนดจ่าย
                    </div>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 12,
                        background: theme.surface,
                        border: `0.5px solid ${theme.hairlineStrong}`,
                        fontFamily: FONT_UI,
                        fontSize: 15,
                        color: theme.ink,
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}
              </>
            )}

            <FormRow theme={theme} label="หมายเหตุ" value={note} onChange={setNote} placeholder="หมายเหตุ (ถ้ามี)" multiline />

            {saveError && (
              <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.danger, marginBottom: 10, textAlign: 'center' }}>
                {saveError}
              </div>
            )}

            <PrimaryButton theme={theme} disabled={!canSave} onClick={handleSave}>
              {submitting
                ? 'กำลังบันทึก...'
                : payChoice === 'staff'
                  ? `สร้างใบเสร็จเบิกคืน · ${fmt(amountNumber)}`
                  : `บันทึกบิล · ${fmt(amountNumber)}`}
            </PrimaryButton>

            {edit && (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  width: '100%',
                  marginTop: 12,
                  padding: '12px 0',
                  background: 'transparent',
                  border: 'none',
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: theme.danger,
                  cursor: 'pointer',
                }}
              >
                ลบบิลนี้
              </button>
            )}
          </div>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          theme={theme}
          danger
          title="ลบบิลนี้?"
          message={`${lineDef?.label ?? ''} ${fmt(amountNumber)} จะถูกลบออกจากบัญชีรายจ่าย`}
          confirmLabel="ลบ"
          onConfirm={() => {
            setConfirmDelete(false);
            void handleDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
