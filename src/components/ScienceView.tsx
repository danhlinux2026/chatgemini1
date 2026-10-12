import React, { useState } from 'react';

const EXAMPLES = ['TP53', 'BRCA1', 'EGFR', 'PCSK9', 'P04637', 'Imatinib'];

export const ScienceView: React.FC = () => {
  const [selectedExample, setSelectedExample] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Science Workbench</h2>
        
        {/* Quick-Try Example Pill Bar */}
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setSelectedExample(ex)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedExample === ex
                  ? 'bg-teal-50 border-teal-200 text-teal-800'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Placeholder Workbench Canvas */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 min-h-[400px] flex items-center justify-center text-gray-500 shadow-sm">
          {selectedExample 
            ? `Analyzing ${selectedExample}... (Workbench module for ${selectedExample} would load here)`
            : 'Select an identifier above to load scientific data or 3D visualization.'}
        </div>
      </div>
    </div>
  );
};
