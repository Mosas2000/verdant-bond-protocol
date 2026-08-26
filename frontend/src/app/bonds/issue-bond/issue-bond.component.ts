import { Component, inject, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';
import { appErrorMessage } from '../../shared/errors/api-error';
import { PendingTransactionsService } from '../../shared/services/pending-transactions.service';
import {
  couponScheduleGroupValidator,
  parseCouponSchedule,
  toEpochSeconds,
} from '../../shared/validators/coupon-schedule.validators';

@Component({
  selector: 'app-issue-bond',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  template: `
    <div class="issue-page">
      <a class="back-link" routerLink="/bonds">← Back to Bonds</a>
      <h1 class="page-title">Issue New Bond</h1>

      @if (error()) {
        <div class="error-banner">{{ error() }}</div>
      }
      @if (success()) {
        <div class="success-banner">Bond issued successfully!</div>
      }

      <form class="issue-form" [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="form-group">
          <label class="form-label" for="projectId">Project ID</label>
          <input id="projectId" class="form-input" formControlName="projectId" placeholder="Enter project ID" />
          @if (form.get('projectId')?.invalid && form.get('projectId')?.touched) {
            <span class="form-error">Project ID is required</span>
          }
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="faceValue">Face Value</label>
            <input id="faceValue" type="number" class="form-input" formControlName="faceValue" placeholder="100000" />
            @if (form.get('faceValue')?.invalid && form.get('faceValue')?.touched) {
              <span class="form-error">Enter a positive value</span>
            }
          </div>
          <div class="form-group">
            <label class="form-label" for="creditType">Credit Type</label>
            <select id="creditType" class="form-select" formControlName="creditType">
              <option value="Carbon">Carbon</option>
              <option value="Biodiversity">Biodiversity</option>
              <option value="Basket">Basket</option>
              <option value="BlueCarbon">Blue Carbon</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="totalSupply">Total Supply</label>
            <input id="totalSupply" type="number" class="form-input" formControlName="totalSupply" placeholder="1000" />
            @if (form.get('totalSupply')?.invalid && form.get('totalSupply')?.touched) {
              <span class="form-error">Enter a positive value</span>
            }
          </div>
          <div class="form-group">
            <label class="form-label" for="maturityDate">Maturity Date</label>
            <input id="maturityDate" type="date" class="form-input" formControlName="maturityDate" />
            @if (form.get('maturityDate')?.invalid && form.get('maturityDate')?.touched) {
              <span class="form-error">Maturity date is required</span>
            }
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="couponSchedule">Coupon Schedule</label>
          <input id="couponSchedule" class="form-input" formControlName="couponSchedule" placeholder="Comma-separated epoch seconds, e.g. 1750000000, 1781536000" />
          @if (form.get('couponSchedule')?.hasError('required') && form.get('couponSchedule')?.touched) {
            <span class="form-error">Enter at least one coupon date</span>
          }
          @if (form.errors?.['couponEmpty'] && form.get('couponSchedule')?.touched) {
            <span class="form-error">Enter at least one valid coupon date</span>
          }
          @if (form.errors?.['couponPast'] && form.get('couponSchedule')?.touched) {
            <span class="form-error">All coupon dates must be in the future</span>
          }
          @if (form.errors?.['couponUnordered'] && form.get('couponSchedule')?.touched) {
            <span class="form-error">Coupon dates must be strictly ascending with no duplicates</span>
          }
          @if (form.errors?.['couponAfterMaturity'] && form.get('couponSchedule')?.touched) {
            <span class="form-error">All coupon dates must be before the maturity date</span>
          }
        </div>

        <div class="form-actions">
          <a class="btn btn-outline" routerLink="/bonds">Cancel</a>
          <button type="submit" class="btn btn-primary" [disabled]="form.invalid || submitting()">
            {{ submitting() ? 'Issuing...' : 'Issue Bond' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .issue-page { max-width: 640px; }
    .back-link { display: inline-block; margin-bottom: 16px; color: #3b82f6; text-decoration: none; font-size: 0.875rem; }
    .back-link:hover { text-decoration: underline; }
    .page-title { font-size: 1.5rem; font-weight: 700; margin-bottom: 24px; }
    .error-banner { background: #fef2f2; color: #ef4444; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.875rem; }
    .success-banner { background: #f0fdf4; color: #22c55e; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: 0.875rem; }
    .issue-form { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .form-group { display: flex; flex-direction: column; margin-bottom: 20px; flex: 1; }
    .form-label { font-size: 0.8125rem; font-weight: 600; color: #1a1a2e; margin-bottom: 6px; }
    .form-input, .form-select { padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.875rem; outline: none; transition: border-color 0.15s; background: #fff; }
    .form-input:focus, .form-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
    .form-error { font-size: 0.75rem; color: #ef4444; margin-top: 4px; }
    .form-row { display: flex; gap: 16px; }
    .form-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
    .btn { padding: 10px 20px; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; text-decoration: none; display: inline-block; }
    .btn-primary { background: #1a1a2e; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #2a2a4e; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-outline { background: #fff; color: #1a1a2e; border: 1px solid #d1d5db; }
    .btn-outline:hover { background: #f0f2f5; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueBondComponent {
  private readonly fb = inject(FormBuilder);
  private readonly apiService = inject(ApiService);
  private readonly router = inject(Router);
  private readonly pendingTx = inject(PendingTransactionsService);

  readonly submitting = signal(false);
  readonly error = signal('');
  readonly success = signal(false);

  form: FormGroup = this.fb.group(
    {
      projectId: ['', Validators.required],
      faceValue: [null, [Validators.required, Validators.min(1)]],
      creditType: ['Carbon', Validators.required],
      totalSupply: [1000, [Validators.required, Validators.min(1)]],
      maturityDate: ['', Validators.required],
      couponSchedule: ['', Validators.required],
    },
    { validators: couponScheduleGroupValidator() },
  );

  onSubmit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set('');
    this.success.set(false);

    const formValue = { ...this.form.value };
    // Epoch seconds throughout — matches the contract's env.ledger().timestamp()
    // and the coupon schedule values (see coupon-schedule.validators.ts).
    formValue.maturityDate = toEpochSeconds(formValue.maturityDate);
    formValue.couponSchedule = parseCouponSchedule(formValue.couponSchedule);

    this.apiService.issueBond(formValue).subscribe({
      next: (res) => {
        this.pendingTx.register(res.transactionHash, 'issue');
        this.success.set(true);
        this.submitting.set(false);
        setTimeout(() => this.router.navigate(['/bonds']), 1500);
      },
      error: (err) => {
        this.error.set(appErrorMessage(err, 'Failed to issue bond'));
        this.submitting.set(false);
      },
    });
  }
}
