import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext.js';
import { useTerminology } from '../contexts/TerminologyContext.js';
import { useDashboardMetrics } from '../features/dashboard/useDashboardMetrics.js';
import { usePeople } from '../features/people/usePeople.js';
import { useCharges } from '../features/charges/useCharges.js';
import { useRecurringPlans } from '../features/charges/useRecurringPlans.js';
import { useDues } from '../features/dues/useDues.js';
import { usePayments } from '../features/payments/usePayments.js';
import { useReceipts } from '../features/receipts/useReceipts.js';
import { useRefunds } from '../features/refunds/useRefunds.js';
import { useSettings } from '../features/settings/useSettings.js';
import { AppShell } from '../layouts/AppShell.js';
import { NavTabId } from '../layouts/Sidebar.js';
import { DashboardOverview } from '../features/dashboard/DashboardOverview.js';
import { ReportsPageSection, SettingsSection, ActivitySection } from '../components/DashboardSections.js';
import { ImportPeopleModal } from '../components/import-export/ImportPeopleModal.js';
import { ExportDropdown } from '../components/import-export/ExportDropdown.js';
import { DuesTable } from '../components/dues/DuesTable.js';
import { ChargesPage } from '../components/charges/ChargesPage.js';
import { OneTimeChargeModal } from '../components/charges/OneTimeChargeModal.js';
import { RecurringPlanModal } from '../components/charges/RecurringPlanModal.js';
import { PeopleTable } from '../components/people/PeopleTable.js';
import { CreatePersonModal } from '../components/people/CreatePersonModal.js';
import { EditPersonModal } from '../components/people/EditPersonModal.js';
import { PaymentsHistoryTable } from '../components/payments/PaymentsHistoryTable.js';
import { CollectPaymentModal } from '../components/payments/CollectPaymentModal.js';
import { ReceiptsTable } from '../components/receipts/ReceiptsTable.js';
import { ReceiptDetail } from '../components/receipts/ReceiptDetail.js';
import { RefundModal } from '../components/refunds/RefundModal.js';
import { AdvanceRefundModal } from '../components/refunds/AdvanceRefundModal.js';
import { PersonDto, RecurringFrequency, RecurringPlanStatus, DueDto, ReceiptDto, UserRole } from '@feecore/shared-types';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  'ROLE_ADMIN': 3,
  'ROLE_COLLECTOR': 2,
  'ROLE_VIEWER': 1,
};

function canAccessTab(userRole: UserRole | null, tab: NavTabId): boolean {
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
  
  const tabRequirements: Record<NavTabId, UserRole[]> = {
    overview: [],
    people: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
    charges: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
    dues: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
    payments: ['ROLE_ADMIN', 'ROLE_COLLECTOR'],
    receipts: ['ROLE_ADMIN', 'ROLE_COLLECTOR', 'ROLE_VIEWER'],
    reports: ['ROLE_ADMIN', 'ROLE_COLLECTOR', 'ROLE_VIEWER'],
    activity: ['ROLE_ADMIN'],
    settings: ['ROLE_ADMIN'],
  };
  
  const requiredRoles = tabRequirements[tab] ?? [];
  if (requiredRoles.length === 0) return true;
  return requiredRoles.some((r) => (ROLE_HIERARCHY[r] ?? 0) <= userLevel);
}

function getFirstAccessibleTab(userRole: UserRole | null): NavTabId {
  const allTabs: NavTabId[] = ['overview', 'people', 'charges', 'dues', 'payments', 'receipts', 'reports', 'activity', 'settings'];
  const accessible = allTabs.find((tab) => canAccessTab(userRole, tab));
  return accessible ?? 'overview';
}

export const DashboardPage: React.FC = () => {
  const { session } = useAuth();
  const tenantId = session?.user.tenantId ?? null;
  const userRole = (session?.user.role as UserRole) ?? null;

  const { pSingular, pPlural, cSingular, cPlural } = useTerminology();

  const accessibleTabs = useMemo(() => {
    const allTabs: NavTabId[] = ['overview', 'people', 'charges', 'dues', 'payments', 'receipts', 'reports', 'activity', 'settings'];
    return allTabs.filter((tab) => canAccessTab(userRole, tab));
  }, [userRole]);

  const defaultTab = useMemo(() => getFirstAccessibleTab(userRole), [userRole]);
  const [activeTab, setActiveTab] = useState<NavTabId>(defaultTab);
  const [showImportModal, setShowImportModal] = useState(false);

  // Redirect to first accessible tab if current tab becomes inaccessible (e.g., role change)
  useEffect(() => {
    if (!accessibleTabs.includes(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [accessibleTabs, activeTab, defaultTab]);

  const { profile, fetchProfile } = useSettings(tenantId ?? '');

  const { metrics, isLoading: metricsLoading, error: metricsError } = useDashboardMetrics(tenantId);
  const {
    people,
    searchTerm: peopleSearch,
    setSearchTerm: setPeopleSearch,
    pagination: peoplePagination,
    isLoading: peopleLoading,
    error: peopleError,
    refetch: refetchPeople,
    loadPage: loadPeoplePage,
    createPerson,
    updatePerson,
    deactivatePerson,
  } = usePeople(tenantId ?? '');

  const {
    charges,
    isLoading: chargesLoading,
    refetch: refetchCharges,
    createCharge,
  } = useCharges(tenantId ?? '');

  const {
    plans,
    isLoading: plansLoading,
    refetch: refetchPlans,
    createPlan,
    toggleStatus,
  } = useRecurringPlans(tenantId ?? '');

  const {
    dues,
    searchTerm: duesSearch,
    setSearchTerm: setDuesSearch,
    statusFilter,
    setStatusFilter,
    pagination: duesPagination,
    isLoading: duesLoading,
    error: duesError,
    refetch: refetchDues,
    loadPage: loadDuesPage,
    generateDues,
  } = useDues(tenantId ?? '');

  const { isCollecting, collectError, collectPayment } = usePayments(tenantId ?? '');
  const {
    receipts,
    pagination: receiptsPagination,
    isLoading: receiptsLoading,
    error: receiptsError,
    refetch: refetchReceipts,
    loadPage: loadReceiptsPage,
    downloadPdf,
    printReceipt,
  } = useReceipts(tenantId ?? '');

  const loadReceiptsPageSimple = useCallback((page: number) => {
    return loadReceiptsPage(page);
  }, [loadReceiptsPage]);

  const {
    isRefunding,
    refundError,
    refundAllocation,
    refundAdvance,
  } = useRefunds(tenantId ?? '');

  const [notification, setNotification] = useState<string | null>(null);
  const showToast = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const [isChargeModalOpen, setIsChargeModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isPersonModalOpen, setIsPersonModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonDto | null>(null);
  const [isGeneratingDues, setIsGeneratingDues] = useState(false);
  const [isCreatingCharge, setIsCreatingCharge] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const [chargeSaveError, setChargeSaveError] = useState<string | null>(null);
  const [planSaveError, setPlanSaveError] = useState<string | null>(null);
  const [personSaveError, setPersonSaveError] = useState<string | null>(null);

  const [collectingDue, setCollectingDue] = useState<DueDto | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<ReceiptDto | null>(null);
  const [refundingAllocation, setRefundingAllocation] = useState<{
    id: string;
    totalAllocatedMinor: string;
    refundedAmountMinor: string;
    chargeCategory?: string;
  } | null>(null);
  const [refundingPerson, setRefundingPerson] = useState<PersonDto | null>(null);

  const onGenerateDues = async () => {
    setIsGeneratingDues(true);
    try {
      const result = await generateDues();
      const msg = result.generatedCount > 0
        ? `Generated ${result.generatedCount} new due(s). ${result.skippedCount} already existed.`
        : `All dues up to date. ${result.skippedCount} skipped (idempotency enforced).`;
      showToast(msg);
      refetchDues();
      refetchPlans();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate dues';
      showToast(msg);
    } finally {
      setIsGeneratingDues(false);
    }
  };

  const onAssessChargeModalSubmit = async (data: {
    personId: string;
    category: string;
    description: string;
    baseAmountMinor: string;
    discountAmountMinor: string;
    dueDate: string;
  }) => {
    setIsCreatingCharge(true);
    setChargeSaveError(null);
    try {
      await createCharge(data);
      const amount = (parseInt(data.baseAmountMinor, 10) || 0) / 100;
      showToast(`Assessed ${cSingular} of ₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`);
      setIsChargeModalOpen(false);
      refetchCharges();
      refetchDues();
    } catch (err) {
      setChargeSaveError(err instanceof Error ? err.message : 'Failed to create charge');
    } finally {
      setIsCreatingCharge(false);
    }
  };

  const onCreatePlanModalSubmit = async (data: {
    personId: string;
    category: string;
    baseAmountMinor: string;
    frequency: RecurringFrequency;
    anchorDay: number;
    startDate: string;
  }) => {
    setIsCreatingPlan(true);
    setPlanSaveError(null);
    try {
      await createPlan(data);
      showToast(`Created ${data.frequency.toLowerCase()} recurring plan for ${pSingular.toLowerCase()}.`);
      setIsPlanModalOpen(false);
      refetchPlans();
    } catch (err) {
      setPlanSaveError(err instanceof Error ? err.message : 'Failed to create plan');
    } finally {
      setIsCreatingPlan(false);
    }
  };

  const onPersonSubmit = async (data: { fullName: string; primaryPhone: string; secondaryPhone?: string; email?: string; address?: string }) => {
    setPersonSaveError(null);
    try {
      await createPerson(data);
      showToast(`Added ${pSingular} "${data.fullName}" successfully.`);
      setIsPersonModalOpen(false);
      refetchPeople();
    } catch (err) {
      setPersonSaveError(err instanceof Error ? err.message : 'Failed to create person');
    }
  };

  const onEditPersonSubmit = async (id: string, data: any) => {
    setPersonSaveError(null);
    try {
      await updatePerson(id, data);
      const person = people.find((p) => p.id === id);
      showToast(`Updated ${pSingular} "${person?.fullName}" successfully.`);
      setEditingPerson(null);
      refetchPeople();
    } catch (err) {
      setPersonSaveError(err instanceof Error ? err.message : 'Failed to update person');
    }
  };

  const onDeactivatePerson = async (person: PersonDto) => {
    try {
      await deactivatePerson(person.id);
      showToast(`Deactivated ${pSingular} "${person.fullName}".`);
      refetchPeople();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to deactivate';
      showToast(msg);
    }
  };

  const onTogglePlanStatus = async (planId: string, currentStatus: string) => {
    try {
      await toggleStatus(planId, currentStatus as RecurringPlanStatus);
      showToast(`Plan status updated.`);
      refetchPlans();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update plan';
      showToast(msg);
    }
  };

  const onCollectPayment = (due: DueDto) => {
    setCollectingDue(due);
  };

  const onPaymentSubmit = async (data: {
    dueId: string;
    paymentMode: any;
    amountMinor?: string;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
  }) => {
    try {
      const result = await collectPayment(data);
      const amount = (parseInt(data.amountMinor || '0', 10) || 0) / 100;
      const receiptNum = result.receipt?.receiptNumber ?? result.payment.id;
      showToast(`Collected ₹${amount.toFixed(2)}. Receipt: #${receiptNum}`);
      setCollectingDue(null);
      refetchDues();
      refetchReceipts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to collect payment';
      showToast(msg);
    }
  };

  const handleRefundAllocation = useCallback(async (data: {
    paymentAllocationId: string;
    refundAmountMinor: string;
    refundMode: string;
    refundReason: string;
    referenceNumber?: string;
  }) => {
    try {
      await refundAllocation(data);
      const amount = (parseInt(data.refundAmountMinor, 10) || 0) / 100;
      showToast(`Refunded ₹${amount.toFixed(2)} against allocation.`);
      setRefundingAllocation(null);
      refetchReceipts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to process refund';
      showToast(msg);
    }
  }, [refundAllocation, refetchReceipts, showToast]);

  const handleRefundAdvance = useCallback(async (data: {
    personId: string;
    refundAmountMinor: string;
    refundMode: string;
    refundReason: string;
    referenceNumber?: string;
  }) => {
    try {
      await refundAdvance(data);
      const amount = (parseInt(data.refundAmountMinor, 10) || 0) / 100;
      showToast(`Refunded ₹${amount.toFixed(2)} from advance wallet.`);
      setRefundingPerson(null);
      refetchReceipts();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to process advance refund';
      showToast(msg);
    }
  }, [refundAdvance, refetchReceipts, showToast]);

  const totalOutstanding = metrics?.totalOutstanding ?? 0;
  const overdueCount = metrics?.overdueCount ?? 0;
  const activePlansCount = plans.filter((p) => p.status === 'ACTIVE').length;
  const peopleCount = metrics?.peopleCount ?? people.length;
  const duesCount = metrics?.openDueCount ?? duesPagination.total;

  const todayCollected = metrics?.todayCollected ?? 0;
  const periodCollected = metrics?.periodCollected ?? 0;
  const allTimeCollected = metrics?.allTimeCollected ?? 0;
  const allTimeNetCollected = metrics?.allTimeNetCollected ?? 0;
  const dueRaisedToday = metrics?.dueRaisedToday ?? 0;
  const totalOverdue = metrics?.totalOverdue ?? 0;
  const advanceHeld = metrics?.advanceHeld ?? 0;
  const activePeopleCount = metrics?.activePeopleCount ?? people.filter((p) => p.status === 'ACTIVE').length;

  // Global search selection handler from top header
  const handleSelectPersonFromSearch = (personId: string) => {
    const found = people.find((p) => p.id === personId);
    if (found) {
      setEditingPerson(found);
    } else {
      setActiveTab('people');
    }
  };

  const handleSelectReceiptFromSearch = (receiptId: string) => {
    const found = receipts.find((r) => r.id === receiptId);
    if (found) {
      setViewingReceipt(found);
    } else {
      setActiveTab('receipts');
    }
  };

  return (
    <AppShell
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      notification={notification}
      tenantId={tenantId ?? ''}
      orgName={profile?.name || session?.user.tenantId || 'FeeCore Universal'}
      counts={{
        people: peopleCount,
        plans: activePlansCount,
        dues: duesCount,
        receipts: receiptsPagination.total,
      }}
      labels={{
        pPlural,
        cPlural,
      }}
      onSelectPerson={handleSelectPersonFromSearch}
      onSelectReceipt={handleSelectReceiptFromSearch}
    >
      {/* 1. Overview (Dashboard) */}
      {activeTab === 'overview' && (
        <div>
          {metricsLoading && !metrics && (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading operational metrics…
            </div>
          )}
          {metricsError && (
            <div
              style={{
                padding: '1rem',
                background: 'var(--status-overdue-bg)',
                border: '1px solid var(--status-overdue-border)',
                color: 'var(--status-overdue)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1.25rem',
                fontSize: '0.875rem',
              }}
            >
              {metricsError}
            </div>
          )}
          {(!metricsLoading || metrics) && !metricsError && (
            <DashboardOverview
              totalOutstanding={totalOutstanding}
              overdueCount={overdueCount}
              activePlansCount={activePlansCount}
              peopleCount={peopleCount}
              duesCount={duesCount}
              cSingular={cSingular}
              pPlural={pPlural}
              pSingular={pSingular}
              todayCollected={todayCollected}
              periodCollected={periodCollected}
              allTimeCollected={allTimeCollected}
              allTimeNetCollected={allTimeNetCollected}
              dueRaisedToday={dueRaisedToday}
              totalOverdue={totalOverdue}
              advanceHeld={advanceHeld}
              activePeopleCount={activePeopleCount}
              openDueCount={duesCount}
              recentDues={dues.slice(0, 5)}
              recentReceipts={receipts.slice(0, 5)}
              onOpenChargeModal={() => setIsChargeModalOpen(true)}
              onOpenPlanModal={() => setIsPlanModalOpen(true)}
              onAddPerson={() => setIsPersonModalOpen(true)}
              onRecordPayment={() => {
                if (dues.length > 0) setCollectingDue(dues[0]);
                else setActiveTab('dues');
              }}
              onViewAllDues={() => setActiveTab('dues')}
              onViewAllPayments={() => setActiveTab('payments')}
              onCollectDue={onCollectPayment}
              onViewReceipt={(r) => setViewingReceipt(r)}
            />
          )}
        </div>
      )}

      {/* 2. People Directory */}
      {activeTab === 'people' && (
        <PeopleTable
          people={people}
          searchTerm={peopleSearch}
          onSearchChange={setPeopleSearch}
          onAddPerson={() => setIsPersonModalOpen(true)}
          onEditPerson={(p) => setEditingPerson(p)}
          onDeactivatePerson={onDeactivatePerson}
          userRole={userRole}
          pagination={peoplePagination}
          onPageChange={loadPeoplePage}
          isLoading={peopleLoading}
          error={peopleError}
          onOpenImport={() => setShowImportModal(true)}
          exportElement={userRole === 'ROLE_ADMIN' ? <ExportDropdown tenantId={tenantId ?? ''} /> : undefined}
        />
      )}

      {/* 3. Charges & Plans */}
      {activeTab === 'charges' && (
        <ChargesPage
          plans={plans}
          charges={charges}
          onOpenChargeModal={() => setIsChargeModalOpen(true)}
          onOpenPlanModal={() => setIsPlanModalOpen(true)}
          onTogglePlanStatus={onTogglePlanStatus}
          isLoadingPlans={plansLoading}
          isLoadingCharges={chargesLoading}
          userRole={userRole}
        />
      )}

      {/* 4. Dues Directory */}
      {activeTab === 'dues' && (
        <DuesTable
          dues={dues}
          searchTerm={duesSearch}
          onSearchChange={setDuesSearch}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          onGenerateDues={onGenerateDues}
          onCollectPayment={onCollectPayment}
          isGenerating={isGeneratingDues}
          isLoading={duesLoading}
          error={duesError}
          pagination={duesPagination}
          onPageChange={loadDuesPage}
          userRole={userRole}
        />
      )}

      {/* 5. Payments History */}
      {activeTab === 'payments' && (
        <PaymentsHistoryTable
          receipts={receipts}
          isLoading={receiptsLoading}
          error={receiptsError}
          pagination={receiptsPagination}
          onPageChange={loadReceiptsPageSimple}
          onViewReceipt={(r) => setViewingReceipt(r)}
        />
      )}

      {/* 6. Receipts */}
      {activeTab === 'receipts' && (
        <ReceiptsTable
          receipts={receipts}
          searchTerm=""
          onSearchChange={() => {}}
          onReceiptClick={(r) => setViewingReceipt(r)}
          isLoading={receiptsLoading}
          error={receiptsError}
          pagination={receiptsPagination}
          onPageChange={loadReceiptsPageSimple}
        />
      )}

      {/* 7. Reports */}
      {activeTab === 'reports' && (
        <ReportsPageSection tenantId={tenantId ?? ''} userRole={userRole} />
      )}

      {/* 8. Activity History */}
      {activeTab === 'activity' && (
        <ActivitySection tenantId={tenantId ?? ''} userRole={userRole} />
      )}

      {/* 9. Settings */}
      {activeTab === 'settings' && (
        <SettingsSection tenantId={tenantId ?? ''} userRole={userRole} />
      )}

      {/* Shared Modals */}
      <CreatePersonModal
        isOpen={isPersonModalOpen}
        onClose={() => {
          setPersonSaveError(null);
          setIsPersonModalOpen(false);
        }}
        onSubmit={onPersonSubmit}
      />

      <EditPersonModal
        isOpen={!!editingPerson}
        person={editingPerson}
        onClose={() => {
          setPersonSaveError(null);
          setEditingPerson(null);
        }}
        onSave={onEditPersonSubmit}
        saveError={personSaveError}
      />

      <OneTimeChargeModal
        isOpen={isChargeModalOpen}
        onClose={() => {
          setChargeSaveError(null);
          setIsChargeModalOpen(false);
        }}
        onSubmit={onAssessChargeModalSubmit}
        people={people.map((p) => ({ id: p.id, fullName: p.fullName, primaryPhone: p.primaryPhone }))}
        isSubmitting={isCreatingCharge}
        saveError={chargeSaveError}
      />

      <RecurringPlanModal
        isOpen={isPlanModalOpen}
        onClose={() => {
          setPlanSaveError(null);
          setIsPlanModalOpen(false);
        }}
        onSubmit={onCreatePlanModalSubmit}
        people={people.map((p) => ({ id: p.id, fullName: p.fullName, primaryPhone: p.primaryPhone }))}
        isSubmitting={isCreatingPlan}
        saveError={planSaveError}
      />

      <CollectPaymentModal
        isOpen={!!collectingDue}
        onClose={() => setCollectingDue(null)}
        onSubmit={onPaymentSubmit}
        due={collectingDue}
        isSubmitting={isCollecting}
        saveError={collectError}
      />

      <ReceiptDetail
        receipt={viewingReceipt}
        onClose={() => setViewingReceipt(null)}
        onDownloadPdf={() => { if (viewingReceipt) window.open(downloadPdf(viewingReceipt.id), '_blank'); }}
        onPrint={() => { if (viewingReceipt) window.open(printReceipt(viewingReceipt.id), '_blank'); }}
        onRefund={(alloc) => setRefundingAllocation(alloc)}
      />

      <RefundModal
        isOpen={!!refundingAllocation}
        onClose={() => setRefundingAllocation(null)}
        onSubmit={handleRefundAllocation}
        allocation={refundingAllocation}
        isSubmitting={isRefunding}
        saveError={refundError}
      />

      <AdvanceRefundModal
        isOpen={!!refundingPerson}
        onClose={() => setRefundingPerson(null)}
        onSubmit={handleRefundAdvance}
        person={refundingPerson}
        isSubmitting={isRefunding}
        saveError={refundError}
      />

      <ImportPeopleModal
        tenantId={tenantId ?? ''}
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportComplete={() => {
          setShowImportModal(false);
          refetchPeople();
        }}
      />
    </AppShell>
  );
};
