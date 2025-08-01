import TopNav from '@/components/layout/top-nav';
import { TPFForm } from '@/components/forms/TPFForm';

export default function Forms() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopNav 
        title="TPF Forms" 
        subtitle="Access Trucking Pros Financial forms and applications"
      />
      
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Main TPF Form */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                TPF Application Form
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                Complete your application or request services directly through our secure TPF portal.
              </p>
            </div>
            
            <TPFForm 
              formId="5QOP-LWPL-QOT0-H74Y"
              viewId="82676"
              title="Service Application"
              className="min-h-[400px]"
            />
          </div>

          {/* Additional form sections can be added here */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Need Help?
            </h3>
            <p className="text-blue-700 dark:text-blue-200 mb-4">
              If you experience any issues with the form, please contact our support team.
            </p>
            <div className="flex flex-wrap gap-4">
              <a 
                href="mailto:support@truckingprosfinancial.com" 
                className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Email Support
              </a>
              <a 
                href="tel:+1-800-TPF-HELP" 
                className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Call Support
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}