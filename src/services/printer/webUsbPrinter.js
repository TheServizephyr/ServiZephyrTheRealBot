export const connectPrinter = async () => {
    try {
        // Request device (filters can be added, but empty allows user to pick any)
        const device = await navigator.usb.requestDevice({ filters: [] });

        await device.open();
        if (device.configuration === null) {
            await device.selectConfiguration(1);
        }

        await device.claimInterface(0); // Usually interface 0 for printers
        return device;
    } catch (error) {
        console.error('Connection failed:', error);
        throw error;
    }
};

export const printData = async (device, data) => {
    try {
        if (!device || !device.opened) {
            throw new Error('Device not connected');
        }

        // Find OUT endpoint
        // Usually Endpoint 1 or 2. We search for 'out' direction.
        const interface0 = device.configuration.interfaces[0];
        const endpoints = interface0.alternates[0].endpoints;
        const outEndpoint = endpoints.find(e => e.direction === 'out');

        if (!outEndpoint) {
            throw new Error('No OUT endpoint found');
        }

        const endpointNumber = outEndpoint.endpointNumber;
        await device.transferOut(endpointNumber, data);

    } catch (error) {
        console.error('Print failed:', error);
        throw error;
    }
};
