"use client";

import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useTransactions } from "@/hooks/use-transactions";
import { useToast } from "@/hooks/use-toast";
import { services as allServices } from "@/lib/data";
import type { Service, Vehicle, Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, Loader2, Sparkles, Wind, Droplets, Car, Send, Camera, Image as ImageIcon, Disc, Star } from "lucide-react";
import { Checkbox } from "../ui/checkbox";
import { VehicleCamera } from "./vehicle-camera";
import { scanPlate } from "@/ai/flows/scan-plate-flow";
import { useVehicles } from "@/hooks/use-vehicles";

const vehicleSchema = z.object({
  licensePlate: z.string().min(3, "License plate is required").toUpperCase(),
});

const newVehicleSchema = z.object({
  licensePlate: z.string().min(3).toUpperCase(),
  type: z.enum(["Sedan", "SUV", "Truck", "Minibus"]),
  ownerName: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const servicesSchema = z.object({
  selectedServices: z.array(z.string()).min(1, "Please select at least one service."),
});

const paymentSchema = z.object({
    paymentMethod: z.enum(["Cash", "Mobile Money"]),
    reference: z.string().optional(),
    sendWhatsApp: z.boolean().default(false),
}).refine(data => {
    if (data.paymentMethod === "Mobile Money") {
        return data.reference && data.reference.length > 0;
    }
    return true;
}, {
    message: "Transaction reference is required for Mobile Money",
    path: ["reference"],
});


type Step = "vehicle" | "new-vehicle" | "services" | "payment" | "receipt";

const serviceIcons: { [key: string]: React.ReactNode } = {
    'Exterior Wash': <Droplets className="h-6 w-6 text-primary" />,
    'Interior Vacuum': <Wind className="h-6 w-6 text-primary" />,
    'Wax & Polish': <Sparkles className="h-6 w-6 text-primary" />,
    'Engine Wash': <Car className="h-6 w-6 text-primary" />,
    'Tire Shine': <Disc className="h-6 w-6 text-primary" />,
    'Full Detail': <Star className="h-6 w-6 text-primary" />,
};

export function Workflow() {
  const [step, setStep] = useState<Step>("vehicle");
  const [currentVehicle, setCurrentVehicle] = useState<Vehicle | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'scan' | 'capture'>('capture');
  const [vehiclePhotoUri, setVehiclePhotoUri] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const { user } = useAuth();
  const { addTransaction } = useTransactions();
  const { toast } = useToast();
  const { vehicles, addVehicle, isLoading: isLoadingVehicles } = useVehicles();

  const vehicleForm = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { licensePlate: "" },
  });

  const newVehicleForm = useForm<z.infer<typeof newVehicleSchema>>({
    resolver: zodResolver(newVehicleSchema),
    defaultValues: {
      licensePlate: "",
      type: "Sedan",
      ownerName: "",
      phoneNumber: "",
    },
  });

  const servicesForm = useForm<z.infer<typeof servicesSchema>>({
    resolver: zodResolver(servicesSchema),
    defaultValues: { selectedServices: [] },
  });

  const paymentForm = useForm<z.infer<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { paymentMethod: "Cash", reference: "", sendWhatsApp: false },
  });

  const handleVehicleSubmit = (data: z.infer<typeof vehicleSchema>) => {
    const found = vehicles.find(v => v.licensePlate === data.licensePlate);
    if (found) {
      setCurrentVehicle(found);
      setStep("services");
    } else {
      newVehicleForm.setValue("licensePlate", data.licensePlate);
      setStep("new-vehicle");
    }
  };

  const handleNewVehicleSubmit = (data: z.infer<typeof newVehicleSchema>) => {
    const newVehicle: Vehicle = { ...data, photoDataUri: vehiclePhotoUri || undefined };
    addVehicle(newVehicle);
    setCurrentVehicle(newVehicle);
    setStep("services");
  };

  const handleServicesSubmit = () => setStep("payment");

  const handlePaymentSubmit = (data: z.infer<typeof paymentSchema>) => {
    if (!currentVehicle || !user) return;
    const selectedIds = servicesForm.getValues("selectedServices");
    const selectedServices = allServices.filter(s => selectedIds.includes(s.id));
    const totalAmount = selectedServices.reduce((acc, s) => acc + s.price, 0);

    const newTransaction: Transaction = {
      id: `txn-${Date.now()}`,
      timestamp: new Date().toISOString(),
      licensePlate: currentVehicle.licensePlate,
      services: selectedServices,
      totalAmount: totalAmount,
      payment: {
        method: data.paymentMethod,
        reference: data.reference,
        amount: totalAmount,
      },
      attendantId: user.id,
      attendantName: user.name,
    };
    
    addTransaction(newTransaction);
    setTransaction(newTransaction);
    setStep("receipt");

    toast({
        title: "Transaction Complete!",
        description: `Wash for ${newTransaction.licensePlate} has been recorded.`,
    });

    if (data.sendWhatsApp && currentVehicle.phoneNumber) {
        const receiptText = `*Spillway Car Wash Receipt*\n\nReceipt ID: ${newTransaction.id}\nDate: ${new Date(newTransaction.timestamp).toLocaleString()}\nPlate: ${newTransaction.licensePlate}\n\nServices:\n${newTransaction.services.map(s => `- ${s.name}: ${formatCurrency(s.price)}`).join('\n')}\n\n*Total: ${formatCurrency(totalAmount)}*\nPaid via: ${newTransaction.payment.method}\n\nThank you for choosing Spillway Car Wash!`;
        const whatsappUrl = `https://wa.me/${currentVehicle.phoneNumber}?text=${encodeURIComponent(receiptText)}`;
        window.open(whatsappUrl, '_blank');
    }
  };

  const handlePhotoCaptured = async (imageDataUri: string) => {
    setIsCameraOpen(false);
    if (cameraMode === 'capture') {
        setVehiclePhotoUri(imageDataUri);
        toast({ title: "Photo captured!" });
    } else if (cameraMode === 'scan') {
        setIsScanning(true);
        toast({ title: "Scanning License Plate...", description: "This might take a moment." });
        try {
            const result = await scanPlate({ photoDataUri: imageDataUri });
            if (result && result.licensePlate) {
                vehicleForm.setValue('licensePlate', result.licensePlate);
                toast({
                    title: "Scan Successful!",
                    description: `License plate set to ${result.licensePlate}.`,
                });
            } else {
                toast({
                    variant: "destructive",
                    title: "Scan Failed",
                    description: "Could not read the license plate. Please try again or enter it manually.",
                });
            }
        } catch (error) {
            console.error("Error scanning license plate:", error);
            toast({
                variant: "destructive",
                title: "Scan Error",
                description: "An unexpected error occurred during the scan.",
            });
        } finally {
            setIsScanning(false);
        }
    }
};

  const startNew = () => {
    vehicleForm.reset({ licensePlate: "" });
    newVehicleForm.reset({ licensePlate: "", type: "Sedan", ownerName: "", phoneNumber: "" });
    servicesForm.reset({ selectedServices: [] });
    paymentForm.reset({ paymentMethod: "Cash", reference: "", sendWhatsApp: false });
    setCurrentVehicle(null);
    setTransaction(null);
    setVehiclePhotoUri(null);
    setStep("vehicle");
  };

  const renderStep = () => {
    const motionProps = {
        initial: { opacity: 0, x: 50 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -50 },
        transition: { duration: 0.3 }
    };
    
    switch (step) {
      case "vehicle":
        return (
          <motion.div {...motionProps}>
          <Card>
            <CardHeader>
              <CardTitle>1. Vehicle Identification</CardTitle>
              <CardDescription>Enter the vehicle's license plate or scan it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...vehicleForm}>
                <form onSubmit={vehicleForm.handleSubmit(handleVehicleSubmit)} className="space-y-4">
                  <FormField
                    control={vehicleForm.control}
                    name="licensePlate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>License Plate</FormLabel>
                        <div className="relative">
                            <FormControl>
                            <Input placeholder="e.g., ABC 1234" {...field} />
                            </FormControl>
                            <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1 h-8 w-8"
                            onClick={() => {
                                setCameraMode('scan');
                                setIsCameraOpen(true);
                            }}
                            disabled={isScanning}
                            >
                            {isScanning ? <Loader2 className="animate-spin" /> : <Camera className="size-5" />}
                            <span className="sr-only">Scan License Plate</span>
                            </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={isScanning || isLoadingVehicles}>
                    {isScanning ? 'Scanning...' : (isLoadingVehicles ? 'Loading Vehicles...' : 'Find Vehicle')}
                     <ChevronRight className="ml-2" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
          </motion.div>
        );
      case "new-vehicle":
        return (
            <motion.div {...motionProps}>
            <Card>
            <CardHeader>
              <CardTitle>Register New Vehicle</CardTitle>
              <CardDescription>This license plate is not in our system. Please add the vehicle details.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...newVehicleForm}>
                <form onSubmit={newVehicleForm.handleSubmit(handleNewVehicleSubmit)} className="space-y-4">
                   <div className="space-y-2">
                      <FormLabel>Vehicle Photo</FormLabel>
                      <Card>
                          <CardContent className="p-2">
                              <div className="aspect-video w-full bg-muted rounded-md flex items-center justify-center overflow-hidden">
                                  {vehiclePhotoUri ? (
                                      <img src={vehiclePhotoUri} alt="Vehicle" className="h-full w-full object-cover rounded-md" />
                                  ) : (
                                      <ImageIcon className="size-12 text-muted-foreground" />
                                  )}
                              </div>
                          </CardContent>
                          <CardFooter className="p-2 pt-0">
                              <Button type="button" variant="outline" className="w-full" onClick={() => {
                                  setCameraMode('capture');
                                  setIsCameraOpen(true);
                              }}>
                                  <Camera className="mr-2" /> {vehiclePhotoUri ? 'Retake' : 'Capture'} Photo
                              </Button>
                          </CardFooter>
                      </Card>
                  </div>

                  <FormField control={newVehicleForm.control} name="licensePlate" render={({ field }) => (
                    <FormItem><FormLabel>License Plate</FormLabel><FormControl><Input {...field} disabled /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <FormField control={newVehicleForm.control} name="type" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vehicle Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select vehicle type" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="Sedan">Sedan</SelectItem>
                          <SelectItem value="SUV">SUV</SelectItem>
                          <SelectItem value="Truck">Truck</SelectItem>
                          <SelectItem value="Minibus">Minibus</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}/>
                  <FormField control={newVehicleForm.control} name="ownerName" render={({ field }) => (
                    <FormItem><FormLabel>Owner Name (Optional)</FormLabel><FormControl><Input placeholder="John Doe" {...field} /></FormControl><FormMessage /></FormItem>
                  )}/>
                   <FormField control={newVehicleForm.control} name="phoneNumber" render={({ field }) => (
                    <FormItem><FormLabel>Phone Number (for WhatsApp)</FormLabel><FormControl><Input placeholder="260977123456" {...field} /></FormControl><FormMessage /></FormItem>
                  )}/>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setStep("vehicle")}><ChevronLeft className="mr-2" />Back</Button>
                    <Button type="submit">Register and Continue <ChevronRight className="ml-2" /></Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
          </motion.div>
        );
      case "services":
        const selectedIds = servicesForm.watch("selectedServices");
        const selected = allServices.filter(s => selectedIds.includes(s.id));
        const total = selected.reduce((acc, s) => acc + s.price, 0);

        return (
            <motion.div {...motionProps} className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>2. Select Services</CardTitle>
                            <CardDescription>Choose the services for {currentVehicle?.licensePlate}.</CardDescription>
                        </CardHeader>
                        <CardContent>
                        <Form {...servicesForm}>
                            <form onSubmit={servicesForm.handleSubmit(handleServicesSubmit)}>
                                <FormField control={servicesForm.control} name="selectedServices" render={({ field }) => (
                                    <FormItem className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {allServices.map((service) => (
                                        <FormField key={service.id} control={servicesForm.control} name="selectedServices" render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                                            <Card className={`w-full cursor-pointer hover:border-primary transition-colors ${field.value?.includes(service.id) ? "border-primary border-2" : ""}`}>
                                                <CardContent className="p-4">
                                                    <FormControl>
                                                        <Checkbox className="hidden" checked={field.value?.includes(service.id)} onCheckedChange={(checked) => {
                                                            return checked ? field.onChange([...field.value, service.id]) : field.onChange(field.value?.filter((value) => value !== service.id));
                                                        }} />
                                                    </FormControl>
                                                    <FormLabel className="font-normal w-full flex items-center justify-between cursor-pointer">
                                                        <div className="flex items-center gap-3">
                                                            {serviceIcons[service.name] || <Car className="h-6 w-6 text-primary" />}
                                                            <span className="text-lg font-medium">{service.name}</span>
                                                        </div>
                                                        <span className="text-lg font-bold">{formatCurrency(service.price)}</span>
                                                    </FormLabel>
                                                </CardContent>
                                            </Card>
                                            </FormItem>
                                        )} />
                                    ))}
                                    <FormMessage className="col-span-full" />
                                </FormItem>
                                )}/>
                            </form>
                        </Form>
                        </CardContent>
                    </Card>
                </div>
                <div className="md:col-span-1">
                    <Card className="sticky top-20">
                        <CardHeader><CardTitle>Order Summary</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            {selected.length > 0 ? selected.map(s => (
                                <div key={s.id} className="flex justify-between"><span>{s.name}</span><span className="font-medium">{formatCurrency(s.price)}</span></div>
                            )) : <p className="text-muted-foreground">No services selected.</p>}
                            <Separator />
                            <div className="flex justify-between text-xl font-bold"><span>Total</span><span>{formatCurrency(total)}</span></div>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-2">
                            <Button className="w-full" onClick={servicesForm.handleSubmit(handleServicesSubmit)} disabled={selected.length === 0}>
                                Proceed to Payment <ChevronRight className="ml-2" />
                            </Button>
                            <Button className="w-full" variant="outline" onClick={() => setStep("vehicle")}><ChevronLeft className="mr-2" />Change Vehicle</Button>
                        </CardFooter>
                    </Card>
                </div>
            </motion.div>
        );
      case "payment":
        const paymentTotal = servicesForm.getValues("selectedServices").reduce((acc, id) => acc + (allServices.find(s => s.id === id)?.price || 0), 0);
        const watchPaymentMethod = paymentForm.watch("paymentMethod");
        return (
            <motion.div {...motionProps}>
            <Card>
                <CardHeader>
                    <CardTitle>3. Payment</CardTitle>
                    <CardDescription>Total amount: <span className="font-bold text-lg text-primary">{formatCurrency(paymentTotal)}</span></CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...paymentForm}>
                        <form onSubmit={paymentForm.handleSubmit(handlePaymentSubmit)} className="space-y-6">
                            <FormField control={paymentForm.control} name="paymentMethod" render={({ field }) => (
                                <FormItem className="space-y-3"><FormLabel>Payment Method</FormLabel>
                                <FormControl>
                                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-1">
                                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="Cash" /></FormControl><FormLabel className="font-normal">Cash</FormLabel></FormItem>
                                    <FormItem className="flex items-center space-x-3 space-y-0"><FormControl><RadioGroupItem value="Mobile Money" /></FormControl><FormLabel className="font-normal">Mobile Money (MTN/Airtel/Zamtel)</FormLabel></FormItem>
                                    </RadioGroup>
                                </FormControl><FormMessage />
                                </FormItem>
                            )}/>
                            {watchPaymentMethod === "Mobile Money" && (
                                <FormField control={paymentForm.control} name="reference" render={({ field }) => (
                                    <FormItem><FormLabel>Mobile Money Reference ID</FormLabel><FormControl><Input placeholder="e.g. MM-12345" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                            )}
                             {currentVehicle?.phoneNumber && (
                                <FormField control={paymentForm.control} name="sendWhatsApp" render={({ field }) => (
                                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    <div className="space-y-1 leading-none"><FormLabel>Send receipt to WhatsApp</FormLabel><FormDescription>A digital receipt will be sent to {currentVehicle.phoneNumber}.</FormDescription></div>
                                    </FormItem>
                                )} />
                            )}
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" onClick={() => setStep("services")}><ChevronLeft className="mr-2" />Back to Services</Button>
                                <Button type="submit">Complete Transaction <Check className="ml-2" /></Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
            </motion.div>
        );
      case "receipt":
        return (
            <motion.div {...motionProps}>
            <Card className="max-w-md mx-auto">
                <CardHeader className="text-center">
                    <div className="mx-auto bg-accent rounded-full h-16 w-16 flex items-center justify-center">
                        <Check className="h-10 w-10 text-accent-foreground" />
                    </div>
                    <CardTitle className="mt-4">Transaction Complete</CardTitle>
                    <CardDescription>Receipt ID: {transaction?.id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                   {currentVehicle?.photoDataUri && (
                     <div className="rounded-md overflow-hidden border">
                        <img src={currentVehicle.photoDataUri} alt="Vehicle" className="aspect-video w-full object-cover" />
                     </div>
                   )}
                    <div className="space-y-2 rounded-md border p-4">
                        <div className="flex justify-between"><span className="text-muted-foreground">License Plate</span><span className="font-medium">{transaction?.licensePlate}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span className="font-medium">{transaction ? new Date(transaction.timestamp).toLocaleString() : ''}</span></div>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-medium">Services Rendered</h4>
                        {transaction?.services.map(s => (
                            <div key={s.id} className="flex justify-between"><span>{s.name}</span><span>{formatCurrency(s.price)}</span></div>
                        ))}
                    </div>
                    <Separator />
                    <div className="flex justify-between font-bold text-lg"><span >Total Paid</span><span>{formatCurrency(transaction?.totalAmount || 0)}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payment Method</span><span>{transaction?.payment.method}</span></div>
                </CardContent>
                <CardFooter className="flex flex-col gap-2">
                    {currentVehicle?.phoneNumber && transaction && (
                        <Button className="w-full" variant="outline" onClick={() => {
                            const receiptText = `*Spillway Car Wash Receipt*\n\nReceipt ID: ${transaction.id}\nDate: ${new Date(transaction.timestamp).toLocaleString()}\nPlate: ${transaction.licensePlate}\n\nServices:\n${transaction.services.map(s => `- ${s.name}: ${formatCurrency(s.price)}`).join('\n')}\n\n*Total: ${formatCurrency(transaction.totalAmount)}*\nPaid via: ${transaction.payment.method}\n\nThank you for choosing Spillway Car Wash!`;
                            const whatsappUrl = `https://wa.me/${currentVehicle.phoneNumber}?text=${encodeURIComponent(receiptText)}`;
                            window.open(whatsappUrl, '_blank');
                        }}>
                            <Send className="mr-2" /> Send to WhatsApp
                        </Button>
                    )}
                    <Button className="w-full" onClick={startNew}>Start New Wash <ChevronRight className="ml-2" /></Button>
                </CardFooter>
            </Card>
            </motion.div>
        );
    }
  };
  
  return (
    <>
      <AnimatePresence mode="wait">{renderStep()}</AnimatePresence>
      <AnimatePresence>
      {isCameraOpen && (
        <VehicleCamera
          onCapture={handlePhotoCaptured}
          onClose={() => setIsCameraOpen(false)}
        />
      )}
      </AnimatePresence>
    </>
  );
}
