import React, { createContext, useContext, useState, ReactNode } from 'react';
import { TenantTerminology } from '@feecore/shared-types';

const defaultTerminology: TenantTerminology = {
  personLabelSingular: 'Person',
  personLabelPlural: 'People',
  chargeLabelSingular: 'Charge',
  chargeLabelPlural: 'Charges'
};

interface TerminologyContextValue {
  terminology: TenantTerminology;
  setTerminology: (terms: TenantTerminology) => void;
  pSingular: string;
  pPlural: string;
  cSingular: string;
  cPlural: string;
}

const TerminologyContext = createContext<TerminologyContextValue | undefined>(undefined);

export const TerminologyProvider: React.FC<{ children: ReactNode; initialTerms?: TenantTerminology }> = ({
  children,
  initialTerms
}) => {
  const [terminology, setTerminology] = useState<TenantTerminology>(initialTerms || defaultTerminology);

  return (
    <TerminologyContext.Provider
      value={{
        terminology,
        setTerminology,
        pSingular: terminology.personLabelSingular,
        pPlural: terminology.personLabelPlural,
        cSingular: terminology.chargeLabelSingular,
        cPlural: terminology.chargeLabelPlural
      }}
    >
      {children}
    </TerminologyContext.Provider>
  );
};

export const useTerminology = (): TerminologyContextValue => {
  const context = useContext(TerminologyContext);
  if (!context) {
    throw new Error('useTerminology must be used within a TerminologyProvider');
  }
  return context;
};
