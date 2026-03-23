import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Truck, FileText, Users, DollarSign } from "lucide-react";
import factorFluxLogo from "@assets/FactorFlux-icon_1774282916669.png";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-md overflow-hidden">
              <img src={factorFluxLogo} alt="FactorFlux" className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-4xl font-bold text-secondary">FactorFlux</h1>
          </div>
          <p className="text-xl text-gray-600 mb-8">
            Streamline your freight factoring operations with our comprehensive invoice processing system
          </p>
          <p className="text-lg text-gray-500 mb-8">
            Trucking Pros Financial - Your trusted partner in freight factoring solutions
          </p>
          <Button size="lg" onClick={() => window.location.href = '/local-login'}>
            Agent Login
          </Button>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card>
            <CardContent className="p-6 text-center">
              <FileText className="w-12 h-12 text-primary mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Document Management</h3>
              <p className="text-gray-600 text-sm">
                Upload and manage rate confirmations, bills of lading, and driver documents
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 text-center">
              <DollarSign className="w-12 h-12 text-success mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Invoice Processing</h3>
              <p className="text-gray-600 text-sm">
                Streamlined workflow for creating, submitting, and tracking invoices
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 text-center">
              <Users className="w-12 h-12 text-warning mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Client Management</h3>
              <p className="text-gray-600 text-sm">
                Comprehensive client database with search and reporting capabilities
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6 text-center">
              <Truck className="w-12 h-12 text-secondary mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Load Tracking</h3>
              <p className="text-gray-600 text-sm">
                Track loads from pickup to delivery with real-time status updates
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}