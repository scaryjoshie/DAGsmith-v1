def process(customer):
    return customer


def branch(customer):
    return "priority" if customer.get("vip") else "standard"
