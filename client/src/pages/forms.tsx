import TopNav from '@/components/layout/top-nav';

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
            
            {/* Direct URL Iframe Embed */}
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <iframe
                src="https://secure.truckingprosfinancial.com/"
                className="w-full h-[800px] border-0 rounded-lg"
                title="TPF Secure Portal"
                sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation"
                loading="lazy"
                style={{
                  backgroundColor: 'white',
                  minHeight: '600px'
                }}
              />
            </div>
            
            {/* Alternative Access Methods */}
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 border border-blue-200 dark:border-blue-800">
              <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-4">
                Alternative Access Options
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <a 
                  href="https://secure.truckingprosfinancial.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                >
                  Open TPF Portal
                  <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <a 
                  href="https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                >
                  Direct Form Link
                  <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </a>
              </div>
              <p className="text-blue-700 dark:text-blue-200 text-sm mt-4">
                Click either option above to access the TPF forms directly. The portal provides access to all available forms and services.
              </p>
            </div>
          </div>

          {/* Support Section */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6 border border-green-200 dark:border-green-800">
            <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-2">
              Need Assistance?
            </h3>
            <p className="text-green-700 dark:text-green-200 mb-4">
              Our support team is available to help you with forms, applications, and any questions about TPF services.
            </p>
            <div className="flex flex-wrap gap-4">
              <a 
                href="mailto:support@truckingprosfinancial.com" 
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email Support
              </a>
              <a 
                href="tel:+1-800-TPF-HELP" 
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call Support
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}