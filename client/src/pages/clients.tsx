import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit, Mail, Phone } from "lucide-react";
import ClientModal from "@/components/modals/client-modal";
import type { Client } from "@shared/schema";

export default function Clients() {
  const { toast } = useToast();
  // Authentication system removed
  const [searchQuery, setSearchQuery] = useState("");
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ["/api/clients"],
  });

  const { data: searchResults } = useQuery({
    queryKey: ["/api/clients/search", { q: searchQuery }],
    enabled: searchQuery.length > 0,
  });

  const displayClients = searchQuery ? (searchResults as Client[] || []) : (clients as Client[] || []);

  const handleCreateClient = () => {
    setSelectedClient(null);
    setIsClientModalOpen(true);
  };

  const handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setIsClientModalOpen(true);
  };

  // Authentication system removed - always show clients page

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Clients" 
          subtitle="Manage your client database"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search clients by name, email, or contact person..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-80 pl-10"
                />
              </div>
            </div>
            
            <Button onClick={handleCreateClient}>
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clientsLoading ? (
              <div className="col-span-full flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              displayClients.map((client: Client) => (
                <Card key={client.id} className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{client.name}</CardTitle>
                      <Badge 
                        variant={client.status === "active" ? "default" : "secondary"}
                        className={client.status === "active" ? "bg-green-100 text-green-800" : ""}
                      >
                        {client.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {client.contactPerson && (
                        <div className="flex items-center text-sm text-gray-600">
                          <span className="font-medium">Contact:</span>
                          <span className="ml-2">{client.contactPerson}</span>
                        </div>
                      )}
                      
                      {client.email && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Mail className="w-4 h-4 mr-2" />
                          <span>{client.email}</span>
                        </div>
                      )}
                      
                      {client.phone && (
                        <div className="flex items-center text-sm text-gray-600">
                          <Phone className="w-4 h-4 mr-2" />
                          <span>{client.phone}</span>
                        </div>
                      )}
                      
                      {client.address && (
                        <div className="text-sm text-gray-600">
                          <span className="font-medium">Address:</span>
                          <p className="mt-1">{client.address}</p>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                      <span className="text-xs text-gray-500">
                        Created {new Date(client.createdAt!).toLocaleDateString()}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleEditClient(client)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {displayClients.length === 0 && !clientsLoading && (
            <Card>
              <CardContent className="text-center py-12">
                <p className="text-gray-500">No clients found</p>
                <Button className="mt-4" onClick={handleCreateClient}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Client
                </Button>
              </CardContent>
            </Card>
          )}
        </main>
      </div>

      <ClientModal
        isOpen={isClientModalOpen}
        onClose={() => setIsClientModalOpen(false)}
        client={selectedClient}
      />
    </div>
  );
}
